# chaoxing

## Commands

### assignments
- Purpose: Chaoxing assignments list
- Args:
  - `course`(optional; type: string); 按课程名过滤（模糊匹配）
  - `status`(optional; type: string; default: 'all'); 按状态过滤
  - `limit`(optional; type: int; default: 20); 最大返回数量
- Usage: `opencli chaoxing assignments [options] -f json`

### exams
- Purpose: Chaoxing exams list
- Args:
  - `course`(optional; type: string); 按课程名过滤（模糊匹配）
  - `status`(optional; type: string; default: 'all'); 按状态过滤
  - `limit`(optional; type: int; default: 20); 最大返回数量
- Usage: `opencli chaoxing exams [options] -f json`
