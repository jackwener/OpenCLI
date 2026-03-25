# chaoxing

## Commands

### assignments
- 用途：学习通作业列表
- 参数：
  - `course`（可选）：类型 string；按课程名过滤（模糊匹配）
  - `status`（可选）：类型 string；默认值 'all'；按状态过滤
  - `limit`（可选）：类型 int；默认值 20；最大返回数量
- 用法：`opencli chaoxing assignments [options] -f json`

### exams
- 用途：学习通考试列表
- 参数：
  - `course`（可选）：类型 string；按课程名过滤（模糊匹配）
  - `status`（可选）：类型 string；默认值 'all'；按状态过滤
  - `limit`（可选）：类型 int；默认值 20；最大返回数量
- 用法：`opencli chaoxing exams [options] -f json`
