# Third-Party Notices

ONDA Engine is licensed under the **Functional Source License, Version 1.1,
Apache 2.0 Future License** (FSL-1.1-ALv2) — see [`LICENSE`](LICENSE).

The engine builds on third-party open-source software, each under its own
license. Notable components distributed in source or binary form include
software under the **Mozilla Public License 2.0 (MPL-2.0)**, among them:

- **Symphonia** (audio decoding) — https://github.com/pdeljanov/Symphonia — MPL-2.0
- **usvg / resvg** (SVG parsing) — https://github.com/linebender/resvg — MPL-2.0

MPL-2.0 is a per-file copyleft license: the source for those files is available
from the projects above, and any modifications we make to MPL-covered files are
made available under MPL-2.0.

> This file is a convenience summary, **not** the complete dependency manifest.
> Generate the authoritative third-party license report before each public
> release and ship it alongside this notice:
>
> ```bash
> cargo about generate about.hbs > THIRD-PARTY.md   # Rust crates
> pnpm licenses list                                # JS packages
> ```
>
> Confirm each dependency's exact license from its own repository; the list
> above is provided for convenience and may change as dependencies evolve.
