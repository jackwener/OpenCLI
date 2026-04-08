# paperreview

## Commands

### feedback
- Purpose: Submit feedback for a paperreview.ai review token
- Args:
  - `token`(required); Review token returned by paperreview.ai
  - `helpfulness`(required; type: int); Helpfulness score from 1 to 5
  - `critical-error`(required); Whether the review contains a critical error
  - `actionable-suggestions`(required); Whether the review contains actionable suggestions
  - `additional-comments`(optional); Optional free-text feedback
- Usage: `opencli paperreview feedback [options] -f json`

### review
- Purpose: Fetch a paperreview.ai review by token
- Args:
  - `token`(required); Review token returned by paperreview.ai
- Usage: `opencli paperreview review [options] -f json`

### submit
- Purpose: Submit a PDF to paperreview.ai for review
- Args:
  - `pdf`(required); Path to the paper PDF
  - `email`(required); Email address for the submission
  - `venue`(optional); Optional target venue such as ICLR or NeurIPS
  - `dry-run`(optional; type: bool; default: false); Validate the input and stop before remote submission
  - `prepare-only`(optional; type: bool; default: false); Request an upload slot but stop before uploading the PDF
- Usage: `opencli paperreview submit [options] -f json`
