# Compact form inspection

2026-09-27

Problem reproduced: Duptronics contact-page `browser state` returned 256 interactive
elements and thousands of words. The existing getFormState API is not exposed in
the CLI, so operators must search the full DOM or invent eval scripts.

Expose that owner through `browser --session <name> forms --tab <id>`. Return URL, explicit
top-document scope and the existing forms/orphanFields envelope. Reuse session/tab
validation. Add browser validity flags, effective disabled state, readonly state,
select options and explicit truncation metadata. Fix label lookup for special IDs.
Mask passwords without reading their values; omit hidden fields and non-fields.

The command only reads state. It does not dispatch invalid events, fill, click,
submit, handle CAPTCHA or retry. Existing fill/click commands retain their roles.
Iframe and shadow-root traversal are outside this change; scope is explicit.

Acceptance: fixture proves labels, required and invalid flags, disabled fieldsets,
select options, truncation, password masking, no hidden token and no invalid event;
CLI help and live background-tab inspection prove the installed command is usable.

Cost: local DOM evaluation only, zero additional metered calls or idle cost.

Live checks on BBest and PracPros found action serialized as {} due to hidden
controls named action. Metadata now uses attributes and the native elements getter.
The DOM fixture includes controls shadowing action, method, name and elements.
