const MIN_OFFSET = 7200; // 2 hours
const MAX_OFFSET = 14 * 86400; // 14 days
export function validateTiming(unixSeconds) {
    if (!Number.isFinite(unixSeconds))
        throw new Error(`无效的时间戳: ${unixSeconds}`);
    const now = Math.floor(Date.now() / 1000);
    if (unixSeconds < now + MIN_OFFSET)
        throw new Error(`定时发布时间必须在至少 2 小时后`);
    if (unixSeconds > now + MAX_OFFSET)
        throw new Error(`定时发布时间不能超过 14 天`);
}
// 读取一个数字(从输入)
// 
function getNumber(input) {
    if (typeof input === 'number')
        return input;
    if (/^\d+$/.test(input)) {
        return Number(input);
    }
	return -1
}
export function toUnixSeconds(input) {
    const now = Math.floor(Date.now() / 1000);
	var num = getNumber(input)
    if (7500 <= num && num < MAX_OFFSET) {
		// 当输入的数字是7500（考虑到上传文件的时间比MIN_OFFSET略大）到MAX_OFFSET之间时，认为输入的是当前时间之后的秒数
        return now + num;
    } 
    else if (num > now + MIN_OFFSET) {
        return num;
    }
	else if (num > 0) {
		return num;
	}
	
    const ms = new Date(input).getTime();
    if (isNaN(ms))
        throw new Error(`无效的时间格式: "${input}"`);
    return Math.floor(ms / 1000);
}
