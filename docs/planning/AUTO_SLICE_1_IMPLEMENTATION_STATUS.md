# AUTO-SLICE-1 実装状況

設計基準: [AUTO_SLICE_1_TECHNICAL_DESIGN.md](AUTO_SLICE_1_TECHNICAL_DESIGN.md)

この変更は AS-0 の座標モデルと AS-1 の PCM 入力基盤を追加する最初の実装単位。
**アタック検出・自動スライスを画面から使える状態にはまだ到達していない。**
設計書の各段階を完了したことや、媒体書き込みの Gate 通過を意味しない。

## 追加したもの

| 配置 | 責務 |
| --- | --- |
| `ot-domain::slicing::PcmFrame` | 元音声の全チャンネルを含む `u64` フレーム座標、正規化された10進文字列の検証、整数時間からの四捨五入 |
| `ot-domain::slicing::FrameRange` | 空でない半開区間 `[start, endExclusive)` と元音声の範囲検証 |
| `ot-domain::slicing::consecutive_slices` | 昇順の自動スライス開始点から区間を構築。終端をスライス数に加算せず、検出0件は空のまま返す |
| `ot-audio::pcm::PcmSnapshot` | 呼び出し側が承認済みの reader から不変バイト列を取得し、期待 SHA-256 と一致した場合だけ保持 |
| `ot-audio::pcm::PcmSnapshot::region` | Symphonia で元フレーム0から復号し、指定区間だけ float32/interleaved PCM として保持。末尾まで検証してから結果を返す |

既存のファイル用デコーダーと新しいメモリ入力は同じ `open_decoder_stream` を使う。
既存の60秒プレビューの挙動は変更していない。新しい区間取得では、例えば61秒からの
区間を取得できる。フロントの既存数値 DTO も変更していない。

## 入力契約と現在の制限

- RIFF/WAVE の整数 PCM と FORM/AIFF、16/24bit、1/2チャンネル、44.1/48kHz。
  RF64、WAVE extensible、AIFC、浮動小数点 PCM などは未対応として明示的に拒否する。
- コンテナ長、チャンク境界と奇数長のパディング、必須チャンクの欠落・重複、
  WAV の frame alignment / byte rate、AIFF の宣言フレーム数を検証する。
- 部分フレーム、空の音声、復号後のフレーム数不一致、途中でのフォーマット変更、
  非有限サンプルはエラー。途中までの PCM を成功結果として返さない。
- 初期バックエンドはメモリ内スナップショットで、入力上限は **64 MiB**。
  この値は入力バイト数の上限であり、プロセス全体のメモリ上限ではない。
  設計の App Support 内ディスクスナップショット最大2 GiBと、キャッシュ合計4 GiBの
  ライフサイクル管理は未実装。上限超過時に切り詰めたり、元ファイルへ戻って復号したりしない。
- 区間取得は試聴用の **30秒 / float32 16 MiB** を上限とする。
  解析用10分領域のストリーミング入力は次の実装で別途追加する。
- 正確な位置と全入力検証を優先し、毎回先頭から末尾まで復号する。
  seek/index による最適化、実測レイテンシー、総メモリ予算の検証は未完了。
- キャンセルを読み込みブロックごと、復号パケットごと、結果返却前に確認する。
  呼び出し側の並行ジョブ管理と期限管理は未実装。
- API はファイルパスを受け取らず、媒体へ書き込まない。
  reader を渡す前の RootRegistry による認可、ファイルを安全に開く処理、
  root/session に束縛したトークンと IPC は今後の統合作業。

## 回帰テストと検証状況

新しい Rust テストは12件。合成音声のみを使い、実媒体は不要。
WAV/AIFF × 16/24bit × mono/stereo × 44.1/48kHz、逆相ステレオ、1フレーム区間、
60秒以降、入力バッファ変更後の不変性、ハッシュ不一致、キャンセル、入力サイズ制限、
壊れた長さ、部分フレーム、重複チャンク、奇数長チャンクを含む。
座標テストでは JS の安全整数を超える値、`u64::MAX`、丸め、終端の数え方も確認する。

作成環境には `cargo` / `rustc` / `rustfmt` がなく、取得も環境制約で完了できなかった。
**これらの Rust テスト、fmt、clippy、および cargo metadata に依存する
architecture チェックはローカル検証済みではない。** 通常の PR CI での検証とレビューが必要。
フロントの型チェック、build、containment は成功。フロントテストは標準 fork pool が
停止したため中断し、`pnpm exec vitest run --pool=threads --maxWorkers=1` で
61ファイル・479テストが成功した。設定ファイル自体は変更していない。
Gate C candidate 契約テストは83件成功。byte-manifest は34件成功・1件失敗。
失敗した既存テストは uid/gid を65534に変更して子プロセスを起動するもので、
この環境では `spawnSync` が `EINVAL` を返すことを最小再現で確認した。
テストや権限チェックを弱める変更は加えていない。

## 次の実装順序

1. この基盤の Rust CI とフォーマットを確認し、エラーがあれば修正する。
2. AS-0 の ownership/DTO 契約、AS-1 のディスクスナップショット・RootRegistry 統合・
   解析ストリーム・range waveform・トークン管理を実装する。
3. AS-2: RustFFT をロックファイル自動生成で追加し、設計の3帯域 spectral flux、
   median/MAD、ピーク選択、PCM onset 補正、キャンセル可能な解析ジョブを実装する。
4. AS-3/AS-4: SQLite draft/CAS、手動編集・lock/tombstone 保護、波形 UI と区間試聴。
5. AS-5以降: `.ot` format profile の証拠を揃えて lossless codec と新規 variant 出力を実装。
   `.ot` バイナリ仕様の未確認事項を推測で埋めず、Intent → Plan → Apply の境界を維持する。
