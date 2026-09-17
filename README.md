# おへやモンスター 🐾

iPadのカメラで **床やテーブルを認識して、その上にモンスターが実在するように現れる** ARゲーム（ポケモンGO風・お部屋で遊ぶ用）。

- **AR**: WebXR `immersive-ar`（iPadOS 18+ / Safari 18、ARKitに委譲）＋ 平面検出(hit-test)で実平面にモンスターを配置
- **3D**: three.js で自作したオリジナル低ポリ生物（ゼロ資産）
- **操作**: モンスターをタップ → ボールを投げて捕獲。捕まえた種類は図鑑に記録（localStorage）
- **サウンド**: Web Audio 完全合成（ゼロ資産・失敗しない）
- **配布**: GitHub Pages（HTTPS必須）＋ URL/QRコード。

## 開発
```bash
npm install
npm run dev      # 開発サーバ
npm run build    # 型検査 + 本番ビルド (dist/)
```

- **AR実機検証**: カメラ透過はヘッドレスで再現不可のため実機iPadで確認。
- **PC/デモモード**: タイトル画面の「デモ（PC用）」で仮想の床・テーブルにモンスターを配置して遊べます（開発/検証用）。

## バージョン
package.json の semver を上げ、タイトル直下の `ver x.y.z` に表示（`__APP_VERSION__` 経由）。
