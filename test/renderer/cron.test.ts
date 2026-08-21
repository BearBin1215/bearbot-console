import { describe, it, expect } from 'vitest';
import { isHighFrequencyCron, isCronValid } from '../../src/lib/cron';

// 测试 isHighFrequencyCron 函数（判定高频cron）
describe('isHighFrequencyCron', () => {
  // #region 无效输入

  it('纯空格返回 false', () => {
    expect(isHighFrequencyCron('   ')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isHighFrequencyCron('')).toBe(false);
  });

  it('不可解析的表达式返回 false', () => {
    expect(isHighFrequencyCron('invalid cron')).toBe(false);
    expect(isHighFrequencyCron('60 60 * * *')).toBe(false);
    expect(isHighFrequencyCron('abc def ghi jkl mno')).toBe(false);
  });

  // #endregion


  // #region 高频调度（应返回 true）

  it('每分钟触发 → 高频', () => {
    expect(isHighFrequencyCron('* * * * *')).toBe(true);
  });

  it('每 2 分钟触发 → 高频（小于默认 10 分钟阈值）', () => {
    expect(isHighFrequencyCron('*/2 * * * *')).toBe(true);
  });

  it('每 9 分钟触发 → 高频（仍小于 10 分钟）', () => {
    expect(isHighFrequencyCron('*/9 * * * *')).toBe(true);
  });

  // #endregion


  // #region 低频调度（应返回 false）

  it('每 10 分钟触发 → 低频（恰好等于默认阈值）', () => {
    expect(isHighFrequencyCron('*/10 * * * *')).toBe(false);
  });

  it('每 15 分钟触发 → 低频', () => {
    expect(isHighFrequencyCron('*/15 * * * *')).toBe(false);
  });

  it('每 30 分钟触发 → 低频', () => {
    expect(isHighFrequencyCron('*/30 * * * *')).toBe(false);
  });

  it('每小时触发 → 低频', () => {
    expect(isHighFrequencyCron('0 * * * *')).toBe(false);
  });

  it('每天凌晨 1 点触发 → 低频', () => {
    expect(isHighFrequencyCron('0 1 * * *')).toBe(false);
  });

  // #endregion


  // #region 分钟范围字段（含 '-'）

  it('分钟范围连续区间 -> 高频（相邻间隔 1 分钟）', () => {
    expect(isHighFrequencyCron('5-8 * * * *')).toBe(true);
  });

  it('单值范围（start === end）-> 低频（等价于单值）', () => {
    // 5-5 等价于 5，每小时 5 分，间隔 60 分钟
    expect(isHighFrequencyCron('5-5 * * * *')).toBe(false);
  });

  // #endregion


  // #region 分钟逗号列表（含 ','）

  it('分钟列表跨小时首尾间隔小于阈值 -> 高频', () => {
    // 56 分到下一小时 5 分，间隔 (60-56)+5 = 9 分钟 < 10
    expect(isHighFrequencyCron('5,56 * * * *')).toBe(true);
  });

  it('分钟列表小时内与跨小时间隔均不小于阈值 -> 低频', () => {
    // 0 分与 30 分间隔 30 分钟；跨小时 (60-30)+0 = 30 分钟
    expect(isHighFrequencyCron('0,30 * * * *')).toBe(false);
  });

  it('分钟列表跨小时首尾间隔恰好等于阈值 -> 低频', () => {
    // 55 分到下一小时 5 分，间隔 (60-55)+5 = 10 分钟，不小于阈值
    expect(isHighFrequencyCron('5,55 * * * *')).toBe(false);
  });

  it('分钟列表等距 10 分钟 -> 低频', () => {
    // 0,10,20,30,40,50 相邻均 10 分钟，跨小时 (60-50)+0 = 10 分钟
    expect(isHighFrequencyCron('0,10,20,30,40,50 * * * *')).toBe(false);
  });

  it('分钟列表含范围元素 -> 高频（5 与 6 间隔 1 分钟）', () => {
    // 触发分钟为 5,6,7,8,30，同小时内相邻对最小间隔 1 分钟，属高频
    expect(isHighFrequencyCron('5-8,30 * * * *')).toBe(true);
  });

  it('分钟列表重复值去重后仅剩一个值 -> 低频', () => {
    // 5,5,5 去重后仅剩 5，每小时一次
    expect(isHighFrequencyCron('5,5,5 * * * *')).toBe(false);
  });

  it('分钟列表多值相邻间隔小于阈值 -> 高频', () => {
    // 1,2,3 相邻间隔 1 分钟 < 10
    expect(isHighFrequencyCron('1,2,3 * * * *')).toBe(true);
  });

  // #endregion


  // #region 带范围的步进（含 '/'）

  it('带范围的步进小于阈值 -> 高频', () => {
    // 1-30 每 5 分钟
    expect(isHighFrequencyCron('1-30/5 * * * *')).toBe(true);
  });

  it('带范围的步进为 8 分钟 -> 高频', () => {
    expect(isHighFrequencyCron('0-59/8 * * * *')).toBe(true);
  });

  it('带范围的步进不小于阈值 -> 低频', () => {
    expect(isHighFrequencyCron('0-59/15 * * * *')).toBe(false);
  });

  // #endregion


  // #region 无法解析的表达式

  it('步进字段非数字 -> 低频', () => {
    // parseInt('abc') = NaN，无法解析按低频处理
    expect(isHighFrequencyCron('*/abc * * * *')).toBe(false);
  });

  // #endregion
});

// 测试 isCronValid 函数（用于 UI 表单验证，确保用户输入的 cron 可被解析）
describe('isCronValid', () => {
  it('空字符串 -> 无效', () => {
    expect(isCronValid('')).toBe(false);
  });

  it('标准 5 字段 cron -> 有效', () => {
    expect(isCronValid('*/5 * * * *')).toBe(true);
  });

  it('每天凌晨 1 点 -> 有效', () => {
    expect(isCronValid('0 1 * * *')).toBe(true);
  });

  it('日字段越界（32）-> 无效', () => {
    expect(isCronValid('* * 32 * *')).toBe(false);
  });

  it('月字段越界（13）-> 无效', () => {
    expect(isCronValid('* * * 13 *')).toBe(false);
  });

  it('分钟字段越界（60）-> 无效', () => {
    expect(isCronValid('60 * * * *')).toBe(false);
  });

  it('小时字段越界（24）-> 无效', () => {
    expect(isCronValid('* 24 * * *')).toBe(false);
  });

  it('无法解析的字符串 -> 无效', () => {
    expect(isCronValid('not a cron')).toBe(false);
  });
});
