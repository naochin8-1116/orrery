# Windows版0.2.0 検証記録

実施日: 2026-11-18（日本時間）。基準リポジトリ: ito-ops/orrery、元コミット `2c516715d8080d4b82b78b095605bd8caa3e7caf`。

## 実施済み

- Node.js構文チェック: core / main / preload / renderer / session / Windowsブリッジ。
- Nodeテスト18件合格：不正な設定・色・パネル・モード・単価・環境変数、ログの重複・ストリーム途中更新、モデル別料金・未価格件数、モニター脱着・負座標、会話中の待受停止と明示終了後の再開、曖昧な開始結果での待受維持、認識起動失敗、Windows補助プロセスの引数と失敗処理、アプリ別音声パケットの検証・停止。
- main.cjs本体のIPCテスト：ElectronとWin32呼び出しを模擬し、外部送信元の拒否、設定ファイルへの保存、背面配置失敗時に旧設定を維持することを検証（上記18件に含む）。
- Chromium画面操作テスト合格：初期表示、データ表示・取得失敗、設定保存・テーマ・カスタムカラー、パネル非表示と中央の拡張、起動失敗、音声会話中の待受表示と終了、再生音拒否、合成音声の開始・停止、ネイティブ音声入力のイベント・状態（模擬）、最小幅960×680。ページのJavaScriptエラーなし。
- PowerShell 7.4.6のパーサーでwake.ps1 / windows.ps1の構文を検証。埋め込みWin32 C#コードのコンパイル合格。WindowsのUI操作自体は実行していない。
- .NET SDK 10.0.404でWindows x64 / .NET 10のアプリ別音声ヘルパーをコンパイル・自己完結型publishに成功。呼び出し側PCに.NETを別途要求しない配布方式。
- 同じ補助DLLをLinux側の.NETランタイムで実行し、OSを呼び出さないFFTの合成正弦波（ピーク周波数）と無音テストが合格。
- Electron公式Windows x64配布物のSHA-256は0.1.0作成時に配布checksums.jsonと照合済み。同じ42.11.18配布物を今回も使用。
  `95db2e9cdbe61d292f28ba42e863518b605115a79e6aebb3c21d5a99b28f35ba`
- electron-builder 26.18.0でWindows x64アプリをLinuxからパッケージング。Win32 / 音声認識のPowerShellファイルと音声ヘルパーの自己完結型ランタイムを同梱。
- 最終パッケージのapp.asar内ソース、外部PowerShell、音声ヘルパーのexeが最終ソース・publish出力と一致することを検証。
- ZIP整合性と必要ファイルを確認。ソースZIPにはnode_modules、ビルド生成物、Git履歴を含めない。

## Windows CIで追加確認（全工程成功）

[実行履歴](https://github.com/naochin8-1116/orrery/actions/runs/44121880877)、対象コミット `e09bd4a775f0418329986f218c37e3ba36b62032`。

- Windows Server 2025上でWindows PowerShell 5.1の構文・Win32連携コードのコンパイル、18件のNodeテスト、Chromium画面操作が合格。
- Windows上で音声ヘルパーのビルドとFFT自己テストが合格。
- 実際のElectronでウィンドウ起動、画面のsandbox/preload、IPC、PC情報取得、設定保存と不正設定拒否を確認。
- Windows上でNSISインストーラーと展開型ZIPの生成、GitHub Artifactsへのアップロードに成功。
- [成果物](https://github.com/naochin8-1116/orrery/actions/runs/44121880877/artifacts/14344644709)、318,403,718バイト。GitHubが記録したZIPのSHA-256は `9babe0050287e6ae93c301114fce2241a1c63af1b13308fdbfa6befb7dab7771`。
- 日本語を含むPowerShellファイルはUTF-8 BOMを付け、Windows PowerShell 5.1で読み違えないよう修正。回帰テストを追加。

## Windows実機で未実施

1. Windows 11上での配布版Orrery.exeの起動とマルチモニターの実際の位置復元。CIでの開発版起動・PC情報取得は上記の通り確認済み。
2. 再生音・マイクからの実際の入力、端末内音声認識、OS権限拒否・言語未導入・実行ポリシー拒否。
3. Windowsプロセスループバックの実デバイス取得、対象プロセスの選別・子プロセスの音・対象終了時の停止。
4. Windows ExplorerのWorkerWへの実際の配置、通知領域からの復帰、DPI・複数画面・Explorer再起動の挙動。
5. 実際のCodexの対応ボタン検出・新規チャット・音声開始・音声終了。UI Automationでボタンが見つからないバージョンには自動操作できない。全バージョン対応を主張しない。
6. PowerShell 5.1による実際の音声・UI Automation操作。構文、埋め込みC#コンパイル、Windowsでの `npm run test:desktop` はCIで確認済み。
7. 手元のWindows 11でのインストール・アンインストール。Windowsでのインストーラー生成・展開型ZIP生成はCIで成功。署名・自動更新はない。

実装済みと実機確認済みを区別する。対象アプリで手動開始した会話の検出、音声UI非搭載のアプリでの音声開始、Windows環境にかかわらない壁紙配置の保証は対象外。
