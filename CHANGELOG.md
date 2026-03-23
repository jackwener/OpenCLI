# Changelog

## [1.3.1](https://github.com/jackwener/opencli/compare/v1.3.0...v1.3.1) (2026-03-22)


### Features

* **plugin:** add update command, hot reload after install, README section ([#307](https://github.com/jackwener/opencli/issues/307)) ([966f6e5](https://github.com/jackwener/opencli/commit/966f6e5))
* **yollomi:** add new commands and update documentation ([#235](https://github.com/jackwener/opencli/issues/235)) ([ea83242](https://github.com/jackwener/opencli/commit/ea83242))
* **record:** add live recording command for API capture ([#300](https://github.com/jackwener/opencli/issues/300)) ([dff0fe5](https://github.com/jackwener/opencli/commit/dff0fe5))
* **weibo:** add weibo search command ([#299](https://github.com/jackwener/opencli/issues/299)) ([c7895ea](https://github.com/jackwener/opencli/commit/c7895ea))
* **v2ex:** add node, user, member, replies, nodes commands ([#282](https://github.com/jackwener/opencli/issues/282)) ([a83027d](https://github.com/jackwener/opencli/commit/a83027d))
* **hackernews:** add new, best, ask, show, jobs, search, user commands ([#290](https://github.com/jackwener/opencli/issues/290)) ([127a974](https://github.com/jackwener/opencli/commit/127a974))
* **doubao-app:** add Doubao AI desktop app CLI adapter ([#289](https://github.com/jackwener/opencli/issues/289)) ([66c4b84](https://github.com/jackwener/opencli/commit/66c4b84))
* **doubao:** add doubao browser adapter ([#277](https://github.com/jackwener/opencli/issues/277)) ([9cdc127](https://github.com/jackwener/opencli/commit/9cdc127))
* **xiaohongshu:** add publish command for 图文 note automation ([#276](https://github.com/jackwener/opencli/issues/276)) ([a6d993f](https://github.com/jackwener/opencli/commit/a6d993f))
* **weixin:** add weixin article download adapter & abstract download helpers ([#280](https://github.com/jackwener/opencli/issues/280)) ([b7c6c02](https://github.com/jackwener/opencli/commit/b7c6c02))


### Bug Fixes

* **tests:** use positional arg syntax in browser search tests ([#302](https://github.com/jackwener/opencli/issues/302)) ([4343ec0](https://github.com/jackwener/opencli/commit/4343ec0))
* **xiaohongshu:** improve search login-wall handling and detail output ([#298](https://github.com/jackwener/opencli/issues/298)) ([f8bf663](https://github.com/jackwener/opencli/commit/f8bf663))
* ensure standard PATH is available for external CLIs ([#285](https://github.com/jackwener/opencli/issues/285)) ([22f5c7a](https://github.com/jackwener/opencli/commit/22f5c7a))
* **xiaohongshu:** scope image selector to avoid downloading avatars ([#293](https://github.com/jackwener/opencli/issues/293)) ([3a21be6](https://github.com/jackwener/opencli/commit/3a21be6))
* add turndown dependency to package.json ([#288](https://github.com/jackwener/opencli/issues/288)) ([2a52906](https://github.com/jackwener/opencli/commit/2a52906))


## [1.3.0](https://github.com/jackwener/opencli/compare/v1.2.3...v1.3.0) (2026-03-21)


### Features

* **daemon:** harden security against browser CSRF attacks ([#268](https://github.com/jackwener/opencli/issues/268)) ([40bd11d](https://github.com/jackwener/opencli/commit/40bd11d))


### Performance

* smart page settle via DOM stability detection ([#271](https://github.com/jackwener/opencli/issues/271)) ([4b976da](https://github.com/jackwener/opencli/commit/4b976da))


### Refactoring

* doctor defaults to live mode, remove setup command entirely ([#263](https://github.com/jackwener/opencli/issues/263)) ([b4a8089](https://github.com/jackwener/opencli/commit/b4a8089))


## [1.2.3](https://github.com/jackwener/opencli/compare/v1.2.2...v1.2.3) (2026-03-21)


### Bug Fixes

* replace all about:blank with data: URI to prevent New Tab Override interception ([#257](https://github.com/jackwener/opencli/issues/257)) ([3e91876](https://github.com/jackwener/opencli/commit/3e91876))
* harden resolveTabId against New Tab Override extension interception ([#255](https://github.com/jackwener/opencli/issues/255)) ([112fdef](https://github.com/jackwener/opencli/commit/112fdef))


## [1.2.2](https://github.com/jackwener/opencli/compare/v1.2.1...v1.2.2) (2026-03-21)


### Bug Fixes

* harden browser automation pipeline (resolves [#249](https://github.com/jackwener/opencli/issues/249)) ([#251](https://github.com/jackwener/opencli/issues/251)) ([71b2c39](https://github.com/jackwener/opencli/commit/71b2c39))


## [1.2.1](https://github.com/jackwener/opencli/compare/v1.2.0...v1.2.1) (2026-03-21)


### Bug Fixes

* **twitter:** harden timeline review findings ([#236](https://github.com/jackwener/opencli/issues/236)) ([4cd0409](https://github.com/jackwener/opencli/commit/4cd0409))
* **wikipedia:** fix search arg name + add random and trending commands ([#231](https://github.com/jackwener/opencli/issues/231)) ([1d56dd7](https://github.com/jackwener/opencli/commit/1d56dd7))
* resolve inconsistent doctor --live report (fix [#121](https://github.com/jackwener/opencli/issues/121)) ([#224](https://github.com/jackwener/opencli/issues/224)) ([387aa0d](https://github.com/jackwener/opencli/commit/387aa0d))


## [1.2.0](https://github.com/jackwener/opencli/compare/v1.1.0...v1.2.0) (2026-03-21)


### Features

* **douban:** add movie adapter with search, top250, subject, marks, reviews commands ([#239](https://github.com/jackwener/opencli/issues/239)) ([70651d3](https://github.com/jackwener/opencli/commit/70651d3))
* **devto:** add devto adapter ([#234](https://github.com/jackwener/opencli/issues/234)) ([ea113a6](https://github.com/jackwener/opencli/commit/ea113a6))
* **twitter:** add --type flag to timeline command ([#83](https://github.com/jackwener/opencli/issues/83)) ([e98cf75](https://github.com/jackwener/opencli/commit/e98cf75))
* **google:** add search, suggest, news, and trends adapters ([#184](https://github.com/jackwener/opencli/issues/184)) ([4e32599](https://github.com/jackwener/opencli/commit/4e32599))
* add douban, sinablog, substack adapters; upgrade medium to TS ([#185](https://github.com/jackwener/opencli/issues/185)) ([bdf5967](https://github.com/jackwener/opencli/commit/bdf5967))
* **xueqiu:** add earnings-date command ([#211](https://github.com/jackwener/opencli/issues/211)) ([fae1dce](https://github.com/jackwener/opencli/commit/fae1dce))
* **browser:** advanced DOM snapshot engine with 13-layer pruning pipeline ([#210](https://github.com/jackwener/opencli/issues/210)) ([d831b04](https://github.com/jackwener/opencli/commit/d831b04))
* **instagram,facebook:** add write actions and extended commands ([#201](https://github.com/jackwener/opencli/issues/201)) ([eb0ccaf](https://github.com/jackwener/opencli/commit/eb0ccaf))
* **grok:** add opt-in --web flow for grok ask ([#193](https://github.com/jackwener/opencli/issues/193)) ([fcff2e4](https://github.com/jackwener/opencli/commit/fcff2e4))
* **tiktok:** add TikTok adapter with 15 commands ([#202](https://github.com/jackwener/opencli/issues/202)) ([4391ccf](https://github.com/jackwener/opencli/commit/4391ccf))
* add Lobste.rs, Instagram, and Facebook adapters ([#199](https://github.com/jackwener/opencli/issues/199)) ([ce484c2](https://github.com/jackwener/opencli/commit/ce484c2))
* **medium:** add medium adapter ([#190](https://github.com/jackwener/opencli/issues/190)) ([06c902a](https://github.com/jackwener/opencli/commit/06c902a))
* plugin system (Stage 0-2) ([1d39295](https://github.com/jackwener/opencli/commit/1d39295))
* make primary args positional across all CLIs ([#242](https://github.com/jackwener/opencli/issues/242)) ([9696db9](https://github.com/jackwener/opencli/commit/9696db9))
* **xueqiu:** make primary args positional ([#213](https://github.com/jackwener/opencli/issues/213)) ([fb2a145](https://github.com/jackwener/opencli/commit/fb2a145))


### Refactoring

* replace hardcoded skipPreNav with declarative navigateBefore field ([#208](https://github.com/jackwener/opencli/issues/208)) ([a228758](https://github.com/jackwener/opencli/commit/a228758))
* **boss:** extract common.ts utilities, fix missing login detection ([#200](https://github.com/jackwener/opencli/issues/200)) ([ae30763](https://github.com/jackwener/opencli/commit/ae30763))
* type discovery core ([#219](https://github.com/jackwener/opencli/issues/219)) ([bd274ce](https://github.com/jackwener/opencli/commit/bd274ce))
* type browser core ([#218](https://github.com/jackwener/opencli/issues/218)) ([28c393e](https://github.com/jackwener/opencli/commit/28c393e))
* type pipeline core ([#217](https://github.com/jackwener/opencli/issues/217)) ([8a4ea41](https://github.com/jackwener/opencli/commit/8a4ea41))
* reduce core any usage ([#216](https://github.com/jackwener/opencli/issues/216)) ([45cee57](https://github.com/jackwener/opencli/commit/45cee57))
* fail fast on invalid pipeline steps ([#237](https://github.com/jackwener/opencli/issues/237)) ([c76f86c](https://github.com/jackwener/opencli/commit/c76f86c))

## [1.1.0](https://github.com/jackwener/opencli/compare/v1.0.6...v1.1.0) (2026-03-20)


### Features

* add antigravity serve command — Anthropic API proxy ([35a0fed](https://github.com/jackwener/opencli/commit/35a0fed8a0c1cb714298f672c19f017bbc9a9630))
* add arxiv and wikipedia adapters ([#132](https://github.com/jackwener/opencli/issues/132)) ([3cda14a](https://github.com/jackwener/opencli/commit/3cda14a2ab502e3bebfba6cdd9842c35b2b66b41))
* add external CLI hub for discovery, auto-installation, and execution of external tools. ([b3e32d8](https://github.com/jackwener/opencli/commit/b3e32d8a05744c9bcdfef96f5ff3085ac72bd353))
* add sinafinance 7x24 news adapter ([#131](https://github.com/jackwener/opencli/issues/131)) ([02793e9](https://github.com/jackwener/opencli/commit/02793e990ef4bdfdde9d7a748960b8a9ed6ea988))
* **boss:** add 8 new recruitment management commands ([#133](https://github.com/jackwener/opencli/issues/133)) ([7e973ca](https://github.com/jackwener/opencli/commit/7e973ca59270029f33021a483ca4974dc3975d36))
* **serve:** implement auto new conv, model mapping, and precise completion detection ([0e8c96b](https://github.com/jackwener/opencli/commit/0e8c96b6d9baebad5deb90b9e0620af5570b259d))
* **serve:** use CDP mouse click + Input.insertText for reliable message injection ([c63af6d](https://github.com/jackwener/opencli/commit/c63af6d41808dddf6f0f76789aa6c042f391f0b0))
* xiaohongshu creator flows migration ([#124](https://github.com/jackwener/opencli/issues/124)) ([8f17259](https://github.com/jackwener/opencli/commit/8f1725982ec06d121d7c15b5cf3cda2f5941c32a))


### Bug Fixes

* **docs:** use base '/' for custom domain and add CNAME file ([#129](https://github.com/jackwener/opencli/issues/129)) ([2876750](https://github.com/jackwener/opencli/commit/2876750891bc8a66be577b06ead4db61852c8e81))
* **serve:** update model mappings to match actual Antigravity UI ([36bc57a](https://github.com/jackwener/opencli/commit/36bc57a9624cdfaa50ffb2c1ad7f9c518c5e6c55))
* type safety for wikiFetch and arxiv abstract truncation ([4600b9d](https://github.com/jackwener/opencli/commit/4600b9d46dc7b56ff564c5f100c3a94c6a792c06))
* use UTC+8 for XHS timestamp formatting (CI timezone fix) ([03f067d](https://github.com/jackwener/opencli/commit/03f067d90764487f0439705df36e1a5c969a7f98))
* **xiaohongshu:** use fixed UTC+8 offset in trend timestamp formatting (CI timezone fix) ([593436e](https://github.com/jackwener/opencli/commit/593436e4cb5852f396fbaaa9f87ef1a0b518e76d))

## [1.0.6](https://github.com/jackwener/opencli/compare/v1.0.5...v1.0.6) (2026-03-20)


### Bug Fixes

* use %20 instead of + for spaces in Bilibili WBI signed requests ([#126](https://github.com/jackwener/opencli/issues/126)) ([4cabca1](https://github.com/jackwener/opencli/commit/4cabca12dfa6ca027b938b80ee6b940b5e89ea5c)), closes [#125](https://github.com/jackwener/opencli/issues/125)
