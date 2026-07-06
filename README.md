# WeChat SVG Publisher

Publish SVG-formatted articles and image messages (小绿书) to a WeChat Official Account draft box.

This repository is a Codex skill plus a self-contained Node.js publishing script. It supports inline SVG, HTML, Markdown rendered by the bundled renderer, local/remote image uploads, draft updates, and WeChat image-message drafts.

## Features

- Publish `.svg`, `.html`, `.md`, and `.markdown` files to WeChat drafts.
- Preserve inline SVG in the article body.
- Render Markdown without `wenyan-cli`; no runtime dependency on Wenyan.
- Upload local, remote, or data URL images to WeChat permanent material storage.
- Replace `<img src="">` and SVG `<image href="">` references with WeChat-hosted image URLs.
- Create image-message / 小绿书 drafts with `article_type: "newspic"`.
- Create a new draft or update an existing draft by `media_id`.
- Cache access tokens and uploaded image materials locally.

## Install

Clone this repository into your Codex skills directory:

```bash
git clone https://github.com/kyanray-dev/wechat-svg.git \
  ~/.codex/skills/wechat-svg-publisher
```

The main publishing command is:

```bash
node ~/.codex/skills/wechat-svg-publisher/scripts/publish-svg-draft.mjs --help
```

When running from a local checkout, you can also use:

```bash
./scripts/publish-svg.sh --help
```

## Requirements

- Node.js 18 or newer.
- A WeChat Official Account AppID and AppSecret.
- Access to the WeChat draft and permanent material APIs.
- Your current public IP added to the WeChat Official Account IP allowlist.

This project does not call or require `wenyan-cli`. It only reads the legacy `~/.config/wenyan-md/credential.json` file as a fallback credential source for compatibility.

## Credential Setup

The script resolves credentials in this order:

1. `--app-id` and `--app-secret`
2. `WECHAT_APP_ID` and `WECHAT_APP_SECRET`
3. export lines in `--tools-md` or `$HOME/.openclaw/workspace/TOOLS.md`
4. `~/.config/wechat-svg-publisher/credential.json`
5. legacy fallback `~/.config/wenyan-md/credential.json`

Environment variables:

```bash
export WECHAT_APP_ID="wx..."
export WECHAT_APP_SECRET="..."
```

Config file:

```bash
mkdir -p ~/.config/wechat-svg-publisher
cat > ~/.config/wechat-svg-publisher/credential.json <<'JSON'
{
  "wechat": {
    "wx_your_app_id": {
      "appSecret": "your_app_secret",
      "alias": "default"
    }
  }
}
JSON
```

You can then select the account by AppID or alias:

```bash
node scripts/publish-svg-draft.mjs \
  --file article.svg \
  --title "SVG 排版文章" \
  --cover cover.jpg \
  --app-id default
```

## Publish SVG

```bash
node scripts/publish-svg-draft.mjs \
  --file article.svg \
  --title "SVG 排版文章" \
  --cover cover.jpg \
  --author "作者名"
```

For `.svg` input, the script strips XML declarations, doctype, `<script>` blocks, and inline event handlers. It also expands simple `.class { ... }` rules from SVG `<style>` blocks into element attributes because WeChat draft previews often strip SVG style blocks.

## Publish Markdown

```bash
node scripts/publish-svg-draft.mjs \
  --file article.md \
  --title "文章标题" \
  --cover cover.jpg \
  --theme lapis \
  --highlight solarized-light
```

Markdown is rendered by the built-in renderer and wrapped in an inline SVG `<foreignObject>` by default.

Publish Markdown as normal HTML instead:

```bash
node scripts/publish-svg-draft.mjs \
  --file article.md \
  --title "文章标题" \
  --cover cover.jpg \
  --no-svg-wrap
```

Set SVG wrapper dimensions:

```bash
node scripts/publish-svg-draft.mjs \
  --file article.md \
  --title "文章标题" \
  --cover cover.jpg \
  --width 677 \
  --height 2400
```

## Publish HTML

```bash
node scripts/publish-svg-draft.mjs \
  --file article.html \
  --title "HTML 排版文章" \
  --cover cover.jpg
```

HTML is published as-is after unsafe SVG/script cleanup. Inline SVG inside the HTML is preserved.

## Publish Image Messages / 小绿书

Use frontmatter `type: image` and place images in the Markdown body:

```md
---
title: 小绿书标题
type: image
digest: 摘要文案
---

![](./1.jpeg)
![](./2.jpeg)
![](./3.jpeg)
```

Publish it:

```bash
node scripts/publish-svg-draft.mjs \
  --file image-post.md
```

Or provide the image list from the CLI:

```bash
node scripts/publish-svg-draft.mjs \
  --file image-post.md \
  --title "小绿书标题" \
  --type image \
  --image-list "./1.jpeg,./2.jpeg,./3.jpeg"
```

You can also use frontmatter `image_list`:

```md
---
title: 小绿书标题
image_list:
  - ./1.jpeg
  - ./2.jpeg
  - ./3.jpeg
---
```

Image-message notes:

- At least 1 image is required.
- At most 20 images are supported.
- If `cover` is omitted, the first image becomes the cover.
- Each image is uploaded as a WeChat permanent image material.
- The created draft uses `article_type: "newspic"` and `image_info.image_list`.

## Dry Run And Preview

Build content and metadata without calling WeChat APIs:

```bash
node scripts/publish-svg-draft.mjs \
  --file article.md \
  --title "预览文章" \
  --cover cover.jpg \
  --dry-run \
  --out /tmp/wechat-svg-preview.html
```

Use `--dry-run --out` before publishing generated SVG, large Markdown articles, or files with local image assets.

## Update Existing Draft

```bash
node scripts/publish-svg-draft.mjs \
  --file article.svg \
  --title "更新后的标题" \
  --cover cover.jpg \
  --update-media-id "DRAFT_MEDIA_ID" \
  --index 0
```

`--index` defaults to `0` and is only needed when updating a specific article inside a multi-article draft.

## Markdown Frontmatter

Supported frontmatter fields:

```yaml
---
title: 文章标题
cover: ./cover.jpg
author: 作者名
digest: 摘要
source_url: https://example.com/original
need_open_comment: true
only_fans_can_comment: false
type: image
image_list:
  - ./1.jpeg
  - ./2.jpeg
---
```

CLI flags override frontmatter values.

## CLI Options

```text
--file <path>                 Input file. Positional file path is also accepted.
--title <text>                Draft title. Overrides Markdown frontmatter.
--cover <path-or-url>         Cover image. Required unless body image upload provides a cover.
--type <news|image>           Draft type. Use image for image message / 小绿书.
--image-list <items>          Comma-separated image paths/URLs for image message. Max 20.
--author <text>               Article author.
--digest <text>               Article summary.
--source-url <url>            Original article URL.
--need-open-comment           Enable comments.
--only-fans-can-comment       Only fans can comment.
--app-id <id>                 WeChat AppID or configured alias.
--app-secret <secret>         WeChat AppSecret.
--access-token <token>        Use an existing access token.
--env-file <path>             Load KEY=VALUE entries before resolving credentials.
--tools-md <path>             Read export WECHAT_APP_ID/SECRET lines.
--theme <id>                  Built-in Markdown theme. Default: lapis.
--highlight <id>              Built-in code block style. Default: solarized-light.
--svg-wrap / --no-svg-wrap    Wrap Markdown-rendered HTML in an SVG foreignObject.
--width <px>                  SVG wrapper width. Default: 677.
--height <px>                 SVG wrapper height. Auto-estimated when omitted.
--out <path>                  Write generated draft content HTML.
--update-media-id <media_id>  Update an existing draft instead of creating a new one.
--index <number>              Article index when updating a multi-article draft. Default: 0.
--dry-run                     Build content and metadata without calling WeChat APIs.
--verbose                     Print upload and cache diagnostics.
```

## SVG Compatibility Notes

- Use inline SVG for SVG artwork.
- Do not rely on JavaScript; scripts and event attributes are stripped.
- Prefer SVG shapes, CSS animation, and SVG `<animate>` over interactive JavaScript.
- Include a `viewBox` so artwork scales in the WeChat client.
- Avoid large base64 images inside SVG. Use local or remote images so the script can upload and replace them.
- Use a normal JPG, PNG, GIF, BMP, or WebP cover image. Do not use SVG as the cover.
- `foreignObject` behavior can vary between WeChat client versions. For maximum compatibility, use native SVG text and shapes for critical visual content.

See [references/svg-wechat-notes.md](references/svg-wechat-notes.md) for additional notes.

## Troubleshooting

- `40164` or `ip not in whitelist`: add your current public IP to the WeChat Official Account backend allowlist.
- `40001` or credential errors: verify AppID/AppSecret, environment variables, or `credential.json`.
- `A cover image is required`: pass `--cover`, or include at least one uploadable body image.
- Broken images in the editor: run with `--verbose`, confirm the local image path exists, and check that remote URLs are reachable.
- Draft body is too large: reduce embedded SVG complexity, avoid base64 images, or split long content.
- Animation is missing: replace JavaScript-driven behavior with CSS or SVG animation.

## Repository Layout

```text
.
|-- SKILL.md                         Codex skill instructions
|-- agents/openai.yaml               Skill UI metadata
|-- references/svg-wechat-notes.md   SVG and WeChat notes
`-- scripts/
    |-- publish-svg-draft.mjs        Main publisher
    `-- publish-svg.sh               Shell wrapper
```
