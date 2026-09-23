# SPY 0DTE V6.4 NEWS ENGINE — frontend candidate

V6.3を基準とする差分。index.html、sw.js、manifest.webmanifestを更新し、既存アイコンとv6.2のlocalStorageキーを保持します。

- 既存バックエンドの `/api/news` を60秒間隔で取得。監視不足・期限切れはUNAVAILABLEとして表示し、新規ENTRYを停止。
- ニュース更新だけではPOSITION管理を進めず、CALL/PUT方向や既存EXIT条件を変更しません。
- ENTRY/FREEZEのPaperログにnewsLevel / newsEvent / newsPhase / newsSource / newsCategory / newsAge / newsRelevance / newsEventIdを保存。
- Service Workerは価格・ニュースAPIを保存しません。
- 主要売買関数10個のV6.3からの不変性、ニュースの方向非干渉、POSITION隔離、見出しエスケープ、期限切れ時停止をローカル検証済み。

このブランチは本番公開前の候補です。バックエンドのnewsRisk応答、永続ストア、公式取得と速報スケジューラーの設定・結合テスト後に本番へ反映します。
ブラウザ内Paperログは既存の200件上限。サーバーへのForward永続保存・長期集計は未実装です。
Webull APIは申請中。実注文送信は有効化しません。
