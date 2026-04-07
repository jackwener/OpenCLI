# xianyu

## Commands

### chat
- Purpose: 打开闲鱼聊一聊会话，并可选发送消息
- Args:
  - `item_id`(required); 闲鱼商品 item_id
  - `user_id`(required); 聊一聊对方的 user_id / peerUserId
  - `text`(optional); Message to send after opening the chat
- Usage: `opencli xianyu chat [options] -f json`

### item
- Purpose: 查看闲鱼商品详情
- Args:
  - `item_id`(required); 闲鱼商品 item_id
- Usage: `opencli xianyu item [options] -f json`

### search
- Purpose: 搜索闲鱼商品
- Args:
  - `query`(required); Search keyword
  - `limit`(optional; type: int; default: 20); Number of results to return
- Usage: `opencli xianyu search [options] -f json`
