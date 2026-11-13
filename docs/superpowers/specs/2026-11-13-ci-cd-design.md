# CI/CD

PRごとにNode.js 24とpackageManager指定のpnpmでビルド、型チェック、lint、
テスト、配布ファイルの確認を実行する。mainへのpushでも同じ確認を行う。

バージョン管理にはChangesetsを使用し、mainへのpushでバージョンとCHANGELOGを
更新するPRを作成する。npmへの公開はGitHub Releaseの公開時に実行する。
Releaseのタグは `v<package.jsonのversion>` と一致する必要がある。
正式版はlatest、プレリリースはnextへ公開する。

方式: マージ時の自動publishも可能だが、Releaseの作成を公開契機とする要望に
合わせ、バージョン更新とpublishを別workflowにする。
認証はRELEASE_PR_TOKENとNPM_TOKENをリポジトリのSecretsに設定する。
通常のGITHUB_TOKENでは自動作成PRのCIが起動しないため専用トークンを使用する。
外部のSecrets登録、コミット、push、実際のnpm publishは今回実行しない。
