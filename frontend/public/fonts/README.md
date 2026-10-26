# Teeho UI fonts

These are self-hosted WOFF2 subsets of Noto Sans SC (variable weight 100–900).
Original source: https://github.com/google/fonts/tree/main/ofl/notosanssc
License: OFL-NotoSansSC.txt (SIL Open Font License 1.1).

teeho-sans-latin.woff2 contains U+0000–024F and U+2000–206F.
teeho-sans-cjk-supplement.woff2 adds U+4EAE, U+53C9, U+6458, U+65CF and U+7075
(亮、叉、摘、族、灵) for inspiration and its onboarding, from the same official
Noto Sans SC variable font source. Its narrow unicode-range supplements the
existing subset without replacing previously shipped glyphs (2026-10-24).
teeho-sans-cjk.woff2 contains CJK characters used by the current public documents
and both frontend locale catalogs. Other user-entered characters fall back to
Noto Sans SC, PingFang SC or Microsoft YaHei UI on the user's device.

Generation used fontTools pyftsubset with --flavor=woff2 and --layout-features=*.
The source TTF and temporary glyph list live in the local .asset/font-source
directory, outside the shipped application. Rebuild the CJK subset when adding
UI characters that must use the hosted font. The private and community public
font directories must contain identical files.
