# SVG WeChat Notes

## Publish Model

The script creates a standard WeChat Official Account draft through `cgi-bin/draft/add`. The article `content` field contains inline SVG/HTML, while the cover is uploaded first through `cgi-bin/material/add_material?type=image` to obtain `thumb_media_id`.

This is different from `wenyan publish`, which renders Markdown to styled HTML and publishes that HTML. This skill preserves SVG markup in the body and uses `wenyan render` only for Markdown input.

## Good SVG Patterns

- Keep one top-level `<svg>` per visual block or wrap multiple SVG blocks in HTML sections.
- Include `viewBox` so the artwork scales in the WeChat client.
- Use `width="100%"` or CSS `width:100%;height:auto;display:block`.
- Use SVG text sparingly. For long readable prose, Markdown rendered through wenyan and wrapped with `foreignObject` is easier to maintain.
- Keep CSS inline in `<style>` or element attributes.

## Risky Patterns

- JavaScript, `<script>`, and event attributes such as `onclick` are stripped by the script.
- `foreignObject` support can vary by WeChat client version. For maximum compatibility, use native SVG text/shapes instead of HTML inside `foreignObject`.
- Base64 images inside SVG make the draft content large. Prefer local/remote image references that the script can upload to WeChat material storage.
- Cover images should be normal image assets, not inline SVG.

## Troubleshooting

- `ip not in whitelist` or `40164`: add the current public IP to the WeChat Official Account backend allowlist.
- `40001` or credential errors: verify `WECHAT_APP_ID` and `WECHAT_APP_SECRET`, or run `wenyan credential -s`.
- `你必须指定一张封面图`: SVG-only content has no uploaded image. Pass `--cover`.
- WeChat editor shows broken images: check whether the source image was local, accessible, non-empty, and uploaded; run with `--verbose`.
- Draft body missing animation: replace JavaScript-driven interaction with CSS or SVG animation.
