# web

## Commands

### read
- Purpose: Fetch any web page and export as Markdown
- Args:
  - `url`(required); Any web page URL
  - `output`(optional; default: './web-articles'); Output directory
  - `download-images`(optional; type: boolean; default: true); Download images locally
  - `wait`(optional; type: int; default: 3); Seconds to wait after page load
- Usage: `opencli web read [options] -f json`
