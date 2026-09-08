use crate::SqliteCatalog;
use ot_domain::slice_draft::{DraftMarker, SliceDraft};
use ot_domain::slicing::{FrameRange, PcmFrame};
use ot_storage_ports::slice_drafts::{
    SliceDraftBinding, SliceDraftCatalog, SliceDraftStoreError as Error,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use std::collections::BTreeSet;

fn unavailable(error: rusqlite::Error) -> Error {
    Error::Unavailable(error.to_string())
}
fn frame(value: String) -> Result<PcmFrame, Error> {
    PcmFrame::parse_decimal(&value).map_err(|_| Error::Invalid("invalid stored frame"))
}
fn range(start: String, end: String) -> Result<FrameRange, Error> {
    FrameRange::new(frame(start)?, frame(end)?).map_err(|_| Error::Invalid("invalid stored range"))
}
fn validate(binding: &SliceDraftBinding, draft: &SliceDraft) -> Result<(), Error> {
    draft.validate().map_err(Error::Invalid)?;
    if !matches!(binding.sample_rate, 44_100 | 48_000)
        || draft.region.within(binding.frame_count).is_err()
    {
        return Err(Error::Invalid("draft source metadata mismatch"));
    }
    Ok(())
}

impl SliceDraftCatalog for SqliteCatalog {
    fn load_slice_draft(&self, binding: &SliceDraftBinding) -> Result<Option<SliceDraft>, Error> {
        let row = self.connection.query_row(
            "SELECT id, revision, sample_rate, frame_count, region_start, region_end FROM slice_drafts WHERE root_fingerprint=?1 AND relative_path=?2 AND source_hash=?3",
            params![binding.root.as_str(), binding.relative_path.as_str(), binding.source_hash.as_str()],
            |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,u32>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?)),
        ).optional().map_err(unavailable)?;
        let Some((id, revision, sample_rate, frame_count, start, end)) = row else {
            return Ok(None);
        };
        let revision =
            u64::try_from(revision).map_err(|_| Error::Invalid("invalid stored revision"))?;
        if sample_rate != binding.sample_rate || frame(frame_count)?.get() != binding.frame_count {
            return Err(Error::Invalid("stored source metadata mismatch"));
        }
        let mut draft = SliceDraft {
            revision,
            region: range(start, end)?,
            markers: vec![],
            suppressed_candidate_ids: BTreeSet::new(),
            exclusions: vec![],
        };
        let mut statement = self.connection.prepare("SELECT marker_id,start_frame,locked,manual,candidate_id,estimated_attack FROM slice_draft_markers WHERE draft_id=?1 ORDER BY ordinal LIMIT 4097").map_err(unavailable)?;
        let rows = statement
            .query_map([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(unavailable)?;
        for row in rows {
            let (id, start, locked, manual, candidate_id, attack) = row.map_err(unavailable)?;
            draft.markers.push(DraftMarker {
                id,
                start: frame(start)?,
                locked,
                manual,
                candidate_id,
                estimated_attack: attack.map(frame).transpose()?,
            });
        }
        let mut statement = self.connection.prepare("SELECT candidate_id FROM slice_draft_suppressed WHERE draft_id=?1 ORDER BY candidate_id LIMIT 32769").map_err(unavailable)?;
        let rows = statement
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(unavailable)?;
        for row in rows {
            draft
                .suppressed_candidate_ids
                .insert(row.map_err(unavailable)?);
        }
        let mut statement = self.connection.prepare("SELECT start_frame,end_frame FROM slice_draft_exclusions WHERE draft_id=?1 ORDER BY ordinal LIMIT 4097").map_err(unavailable)?;
        let rows = statement
            .query_map([id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(unavailable)?;
        for row in rows {
            let (start, end) = row.map_err(unavailable)?;
            draft.exclusions.push(range(start, end)?);
        }
        validate(binding, &draft)?;
        Ok(Some(draft))
    }

    fn save_slice_draft(
        &mut self,
        binding: &SliceDraftBinding,
        draft: &SliceDraft,
        expected_revision: u64,
    ) -> Result<SliceDraft, Error> {
        validate(binding, draft)?;
        if draft.revision != expected_revision || expected_revision >= i64::MAX as u64 {
            return Err(Error::Conflict);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(unavailable)?;
        let next_revision = expected_revision + 1;
        let count = if expected_revision == 0 {
            transaction.execute("INSERT INTO slice_drafts (root_fingerprint,relative_path,source_hash,sample_rate,frame_count,region_start,region_end,revision) VALUES (?1,?2,?3,?4,?5,?6,?7,1) ON CONFLICT(root_fingerprint,relative_path,source_hash) DO NOTHING",
                params![binding.root.as_str(),binding.relative_path.as_str(),binding.source_hash.as_str(),binding.sample_rate,binding.frame_count.to_string(),draft.region.start().to_string(),draft.region.end_exclusive().to_string()]).map_err(unavailable)?
        } else {
            transaction.execute("UPDATE slice_drafts SET region_start=?4,region_end=?5,revision=?6 WHERE root_fingerprint=?1 AND relative_path=?2 AND source_hash=?3 AND revision=?7 AND sample_rate=?8 AND frame_count=?9",
                params![binding.root.as_str(),binding.relative_path.as_str(),binding.source_hash.as_str(),draft.region.start().to_string(),draft.region.end_exclusive().to_string(),next_revision as i64,expected_revision as i64,binding.sample_rate,binding.frame_count.to_string()]).map_err(unavailable)?
        };
        if count != 1 {
            return Err(Error::Conflict);
        }
        let id: i64=transaction.query_row("SELECT id FROM slice_drafts WHERE root_fingerprint=?1 AND relative_path=?2 AND source_hash=?3",params![binding.root.as_str(),binding.relative_path.as_str(),binding.source_hash.as_str()],|r|r.get(0)).map_err(unavailable)?;
        for table in [
            "slice_draft_markers",
            "slice_draft_suppressed",
            "slice_draft_exclusions",
        ] {
            transaction
                .execute(&format!("DELETE FROM {table} WHERE draft_id=?1"), [id])
                .map_err(unavailable)?;
        }
        for (ordinal, marker) in draft.markers.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO slice_draft_markers VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        id,
                        ordinal as u32,
                        marker.id,
                        marker.start.to_string(),
                        marker.locked,
                        marker.manual,
                        marker.candidate_id,
                        marker.estimated_attack.map(|f| f.to_string())
                    ],
                )
                .map_err(unavailable)?;
        }
        for candidate in &draft.suppressed_candidate_ids {
            transaction
                .execute(
                    "INSERT INTO slice_draft_suppressed VALUES (?1,?2)",
                    params![id, candidate],
                )
                .map_err(unavailable)?;
        }
        for (ordinal, range) in draft.exclusions.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO slice_draft_exclusions VALUES (?1,?2,?3,?4)",
                    params![
                        id,
                        ordinal as u32,
                        range.start().to_string(),
                        range.end_exclusive().to_string()
                    ],
                )
                .map_err(unavailable)?;
        }
        transaction.commit().map_err(unavailable)?;
        let mut saved = draft.clone();
        saved.revision = next_revision;
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ot_domain::{ContentHash, RootRelativePath};
    use ot_storage_ports::CatalogRootIdentity;
    fn binding() -> SliceDraftBinding {
        SliceDraftBinding {
            root: CatalogRootIdentity::new(format!("rootfp:v1:{}", "1".repeat(64))).unwrap(),
            relative_path: RootRelativePath::parse("SET/AUDIO/test.wav").unwrap(),
            source_hash: ContentHash::parse(format!("sha256:{}", "a".repeat(64))).unwrap(),
            sample_rate: 44_100,
            frame_count: 44_100,
        }
    }
    #[test]
    fn draft_survives_reopen_and_projection_cleanup_and_enforces_cas() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("catalog.sqlite3");
        let mut catalog = SqliteCatalog::open(&path).unwrap();
        let binding = binding();
        let mut draft = SliceDraft::empty(range("0".into(), "44100".into()).unwrap());
        draft.markers.push(ot_domain::slice_draft::DraftMarker {
            id: "manual-boundary".into(),
            start: PcmFrame::new(100),
            locked: true,
            manual: true,
            candidate_id: Some("retained-onset".into()),
            estimated_attack: Some(PcmFrame::new(101)),
        });
        draft
            .suppressed_candidate_ids
            .insert("deleted-onset".into());
        draft
            .exclusions
            .push(range("1000".into(), "1050".into()).unwrap());
        let saved = catalog.save_slice_draft(&binding, &draft, 0).unwrap();
        assert_eq!(saved.revision, 1);
        assert!(matches!(
            catalog.save_slice_draft(&binding, &draft, 0),
            Err(Error::Conflict)
        ));
        catalog
            .connection
            .execute("DELETE FROM projects", [])
            .unwrap();
        catalog.connection.execute("DELETE FROM sets", []).unwrap();
        drop(catalog);
        let mut catalog = SqliteCatalog::open(&path).unwrap();
        assert_eq!(
            catalog.load_slice_draft(&binding).unwrap(),
            Some(saved.clone())
        );
        let updated = catalog.save_slice_draft(&binding, &saved, 1).unwrap();
        assert_eq!(updated.revision, 2);
        assert!(matches!(
            catalog.save_slice_draft(&binding, &saved, 1),
            Err(Error::Conflict)
        ));
        let mut other = binding.clone();
        other.relative_path = RootRelativePath::parse("SET/AUDIO/other.wav").unwrap();
        assert!(catalog.load_slice_draft(&other).unwrap().is_none());
        let mut second_connection = SqliteCatalog::open(&path).unwrap();
        assert!(matches!(
            second_connection.save_slice_draft(&binding, &saved, 1),
            Err(Error::Conflict)
        ));
        let mut invalid = updated.clone();
        invalid.markers[0].start = PcmFrame::new(44_100);
        assert!(catalog.save_slice_draft(&binding, &invalid, 2).is_err());
        assert_eq!(
            second_connection.load_slice_draft(&binding).unwrap(),
            Some(updated)
        );
    }
}
