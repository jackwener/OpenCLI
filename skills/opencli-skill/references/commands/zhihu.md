# zhihu

## Commands

### answer
- Purpose: Answer a Zhihu question
- Args:
  - `target`(required); Zhihu question URL or typed target
  - `text`(optional); Answer text
  - `file`(optional); Answer text file path
  - `execute`(optional; type: boolean); Actually perform the write action
- Usage: `opencli zhihu answer [options] -f json`

### comment
- Purpose: Create a top-level comment on a Zhihu answer or article
- Args:
  - `target`(required); Zhihu target URL or typed target
  - `text`(optional); Comment text
  - `file`(optional); Comment text file path
  - `execute`(optional; type: boolean); Actually perform the write action
- Usage: `opencli zhihu comment [options] -f json`

### download
- Purpose: Export Zhihu article to Markdown
- Args:
  - `url`(required); Article URL (zhuanlan.zhihu.com/p/xxx)
  - `output`(optional; default: './zhihu-articles'); Output directory
  - `download-images`(optional; type: boolean; default: false); Download images locally
- Usage: `opencli zhihu download [options] -f json`

### favorite
- Purpose: Favorite a Zhihu answer or article into a specific collection
- Args:
  - `target`(required); Zhihu target URL or typed target
  - `collection`(optional); Collection name
  - `collection-id`(optional); Stable collection id
  - `execute`(optional; type: boolean); Actually perform the write action
- Usage: `opencli zhihu favorite [options] -f json`

### follow
- Purpose: Follow a Zhihu user or question
- Args:
  - `target`(required); Zhihu target URL or typed target
  - `execute`(optional; type: boolean); Actually perform the write action
- Usage: `opencli zhihu follow [options] -f json`

### hot
- Purpose: Zhihu hot list
- Args: None
- Usage: `opencli zhihu hot [options] -f json`

### like
- Purpose: Like a Zhihu answer or article
- Args:
  - `target`(required); Zhihu target URL or typed target
  - `execute`(optional; type: boolean); Actually perform the write action
- Usage: `opencli zhihu like [options] -f json`

### question
- Purpose: Zhihu question detail and answers
- Args:
  - `id`(required); Question ID (numeric)
  - `limit`(optional; type: int; default: 5); Number of answers
- Usage: `opencli zhihu question [options] -f json`

### search
- Purpose: Search Zhihu
- Args: None
- Usage: `opencli zhihu search [options] -f json`

### target
- Purpose: zhihu target operation
- Args: None
- Usage: `opencli zhihu target [options] -f json`
