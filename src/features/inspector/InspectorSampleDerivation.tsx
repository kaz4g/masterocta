import { useEffect, useState } from "react";
import {
  derivationsApi,
  type AssetDerivationRecord,
  type DerivationsApi,
} from "../../api/derivations";
import { useTranslate, type MessageKey } from "../../i18n";
import { formatPreviewFrameTimeSeconds } from "../waveform/frameMath";

export interface InspectorSampleDerivationProps {
  rootId: string;
  assetId: string;
  sampleRate?: number | null;
  refreshGeneration?: number;
  api?: DerivationsApi;
}

function ipcErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

const DERIVATION_KIND_LABELS: Record<string, MessageKey> = {
  SLICE_EXPORT: "inspector.derivationKind.SLICE_EXPORT",
  TRIM: "inspector.derivationKind.TRIM",
  STEM: "inspector.derivationKind.STEM",
};

function kindLabel(kind: string, t: ReturnType<typeof useTranslate>): string {
  const key = DERIVATION_KIND_LABELS[kind];
  return key ? t(key) : kind;
}

function formatRange(
  record: AssetDerivationRecord,
  sampleRate: number | null | undefined,
  t: ReturnType<typeof useTranslate>,
): string {
  if (record.parameters.status === "unavailable") {
    return t("inspector.derivationParametersUnavailable");
  }
  const start = record.parameters.startFrame;
  const end = record.parameters.endFrameExclusive;
  if (start === undefined || end === undefined) {
    return t("inspector.derivationRangeUnknown");
  }
  if (sampleRate) {
    const startLabel = formatPreviewFrameTimeSeconds(start, sampleRate);
    const endLabel = formatPreviewFrameTimeSeconds(end, sampleRate);
    return t("inspector.derivationRangeTime", { start: startLabel, end: endLabel });
  }
  return t("inspector.derivationRangeFrames", { start, end });
}

function DerivationRow({
  record,
  sampleRate,
}: {
  record: AssetDerivationRecord;
  sampleRate?: number | null;
}) {
  const t = useTranslate();
  return (
    <article className="mo-inspector-derivation__row" data-testid="inspector-derivation-row">
      <dl className="mo-inspector-sample-info">
        <div>
          <dt>{t("inspector.derivationType")}</dt>
          <dd>{kindLabel(record.kind, t)}</dd>
        </div>
        <div>
          <dt>{t("inspector.derivationRange")}</dt>
          <dd>{formatRange(record, sampleRate, t)}</dd>
        </div>
        <div>
          <dt>{t("inspector.derivationSource")}</dt>
          <dd>
            <code>{record.parentAssetId}</code>
            {!record.parentAvailable ? (
              <span className="mo-inspector-derivation__unavailable">
                {t("inspector.derivationParentUnavailable")}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{t("inspector.derivationProcessor")}</dt>
          <dd>
            {record.processor.name} ({record.processor.revision})
          </dd>
        </div>
        <div>
          <dt>{t("inspector.derivationCreatedAt")}</dt>
          <dd>{record.createdAt}</dd>
        </div>
        <div>
          <dt>{t("inspector.derivationAssetId")}</dt>
          <dd><code>{record.assetId}</code></dd>
        </div>
      </dl>
    </article>
  );
}

export function InspectorSampleDerivation({
  rootId,
  assetId,
  sampleRate = null,
  refreshGeneration = 0,
  api = derivationsApi,
}: InspectorSampleDerivationProps) {
  const t = useTranslate();
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [selfDerivation, setSelfDerivation] = useState<AssetDerivationRecord | null>(null);
  const [children, setChildren] = useState<AssetDerivationRecord[]>([]);
  const [isDerived, setIsDerived] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorCode(null);
    setSelfDerivation(null);
    setChildren([]);
    setIsDerived(false);
    Promise.all([
      api.getAssetDerivation(rootId, assetId),
      api.listDerivedChildren(rootId, assetId),
    ]).then(
      ([getResult, childrenResult]) => {
        if (!active) return;
        setIsDerived(getResult.isDerived);
        setSelfDerivation(getResult.derivation);
        setChildren(childrenResult.children);
        setLoading(false);
      },
      (reason) => {
        if (!active) return;
        setErrorCode(ipcErrorCode(reason) ?? "UNKNOWN");
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api, assetId, refreshGeneration, rootId]);

  if (loading) {
    return (
      <section className="mo-inspector-derivation" data-testid="inspector-derivation-loading">
        <p>{t("inspector.derivationLoading")}</p>
      </section>
    );
  }

  if (errorCode) {
    const errorKeys: Record<string, MessageKey> = {
      CATALOG_ASSET_NOT_FOUND: "inspector.derivationError.CATALOG_ASSET_NOT_FOUND",
      CATALOG_UNAVAILABLE: "inspector.derivationError.CATALOG_UNAVAILABLE",
      CATALOG_DERIVATION_INVALID: "inspector.derivationError.CATALOG_DERIVATION_INVALID",
      INVALID_ASSET_ID: "inspector.derivationError.INVALID_ASSET_ID",
    };
    const messageKey = errorKeys[errorCode];
    const summary = messageKey ? t(messageKey) : t("inspector.derivationError.generic");
    return (
      <section className="mo-inspector-derivation" role="alert" data-testid="inspector-derivation-error">
        <p>{summary}</p>
      </section>
    );
  }

  if (isDerived && selfDerivation) {
    return (
      <section className="mo-inspector-derivation" data-testid="inspector-derivation-parent">
        <h3 className="mo-inspector-derivation__heading">{t("inspector.derivationSectionDerived")}</h3>
        <DerivationRow record={selfDerivation} sampleRate={sampleRate} />
      </section>
    );
  }

  if (children.length > 0) {
    return (
      <section className="mo-inspector-derivation" data-testid="inspector-derivation-children">
        <h3 className="mo-inspector-derivation__heading">{t("inspector.derivationSectionChildren")}</h3>
        {children.map((child) => (
          <DerivationRow key={child.assetId} record={child} sampleRate={sampleRate} />
        ))}
      </section>
    );
  }

  return (
    <section className="mo-inspector-derivation" data-testid="inspector-derivation-original">
      <p>{t("inspector.derivationOriginalMaterial")}</p>
    </section>
  );
}
