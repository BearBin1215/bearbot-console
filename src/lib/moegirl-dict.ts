/**
 * 用户组元数据映射
 *
 * @see https://mzh.moegirl.org.cn/Special:%E7%BE%A4%E7%BB%84%E6%9D%83%E9%99%90
 */

/** 用户组元数据 */
interface GroupMeta {
  /** 用户组全称 */
  label: string;
  /** 用户组标识 */
  badge: string;
}

/** 用户组元数据映射（键为 MediaWiki 用户组名） */
export const groupMeta: Record<string, GroupMeta> = {
  bot: { label: '机器人', badge: '机' },
  bureaucrat: { label: '行政员', badge: '行' },
  checkuser: { label: '用户查核员', badge: '查' },
  extendedconfirmed: { label: '延伸确认用户', badge: '延' },
  'file-maintainer': { label: '文件维护员', badge: '档' },
  goodeditor: { label: '优质编辑者', badge: '优' },
  honoredmaintainer: { label: '荣誉维护人员', badge: '荣' },
  'interface-admin': { label: '界面管理员', badge: '界' },
  'ipblock-exempt': { label: 'IP封禁豁免者', badge: '免' },
  'manually-confirmed': { label: '手动确认用户', badge: '手' },
  patroller: { label: '维护姬', badge: '维' },
  'special-contributor': { label: '特殊贡献者', badge: '特' },
  staff: { label: 'STAFF', badge: '职' },
  suppress: { label: '监督员', badge: '监' },
  sysop: { label: '管理员', badge: '管' },
  techeditor: { label: '技术编辑员', badge: '技' },
};
