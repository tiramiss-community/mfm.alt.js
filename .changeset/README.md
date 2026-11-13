# Changesets

公開パッケージの変更を含むPRでは `pnpm changeset` を実行し、変更内容と
バージョンの上げ幅 (patch / minor / major) を記録してください。
生成されたMarkdownファイルを変更と一緒にコミットします。
CIやドキュメントだけの変更にはChangesetは不要です。

リリース手順と必要なSecretsは [README.md](../README.md#リリース) を参照してください。
