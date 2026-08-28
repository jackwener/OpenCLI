# Dribbble

**Mode**: 🌐 Browser · **Domain**: `dribbble.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli dribbble shot <query>` | Search shots by keyword |
| `opencli dribbble shot-detail <shot>` | Show one shot's authorship, media, palette, and availability |
| `opencli dribbble designer` | Browse designers and agencies |
| `opencli dribbble profile <designer>` | Show a designer's public profile and about fields |
| `opencli dribbble portfolio <designer>` | List a designer's published or liked shots |
| `opencli dribbble service <designer>` | List and filter a designer's services |
| `opencli dribbble collection <designer>` | List a designer's public collections |
| `opencli dribbble member <designer>` | List a team profile's public members |
| `opencli dribbble whoami` | Show the signed-in Dribbble identity |
| `opencli dribbble login` | Open Dribbble's sign-in flow |

## Usage Examples

```bash
# Search Dribbble's public popular or New & Noteworthy views
opencli dribbble shot "mobile ui" --sort popular --limit 10 -f json
opencli dribbble shot "mobile ui" --sort recent --limit 10 -f json

# The personalized Following view requires a signed-in browser session
opencli dribbble shot "mobile ui" --sort following --limit 10 -f json

# Inspect a shot and a designer's public surfaces
opencli dribbble shot-detail 27679566 -f json
opencli dribbble profile halolab -f json
opencli dribbble portfolio halolab --type work --limit 10 -f json
opencli dribbble service halolab --query branding --limit 10 -f json
opencli dribbble collection halolab --limit 10 -f json
opencli dribbble member halolab --limit 10 -f json

# Browse designers and verify authentication
opencli dribbble designer --query product --limit 10 -f json
opencli dribbble whoami -f json
```

`shot-detail` accepts either a numeric shot id or a full `dribbble.com/shots/...` URL. Designer arguments are Dribbble usernames or profile slugs. List limits must be positive integers and cannot exceed 30.

For `portfolio --type likes`, `designer` identifies each shot's author, not the profile that liked it. It remains empty when Dribbble omits the author label; OpenCLI does not guess ownership.

## Output

Shot commands return stable identity and URL fields plus the metadata visible on Dribbble, such as author, likes, views, media URLs, palette, or work availability. Profile output includes biography, counts, location, membership date, skills, languages, social links, website, and avatar. The remaining list commands preserve rank plus the visible identity and metadata for each service, collection, or team member.

Public reads use Dribbble's server-rendered browser pages. Direct HTTP requests are challenged by AWS WAF, and the official Dribbble API requires a separate OAuth application and token, so the adapter does not depend on a private web API.

## Prerequisites

- Chrome running with the [Browser Bridge extension](/guide/browser-bridge) installed
- A Dribbble login only for `whoami`, `login`, and `shot --sort following`
