export const relationTypes = ['prerequisite', 'approximation_of', 'applied_to', 'related'];
export const relationNames = ['前置知识', '近似自', '应用于', '相关知识'];
export const relationLabel = (type: string) => relationNames[relationTypes.indexOf(type)] || type;
export const blank = () => ({
  title: '',
  summary: '',
  markdown: '',
  template: 'plain',
  relations: [] as any[],
  baseRevisionId: null as string | null,
  changeNote: '',
});
export const templates: Record<string, string> = {
  plain: '## 概述\n\n\n## 参考资料\n',
  handbook:
    '## 适用对象\n\n## 准备材料\n\n- \n\n## 办理步骤\n\n1. \n2. \n\n## 注意事项\n\n## 信息来源\n',
  academic: '## 概念\n\n## 假设与适用条件\n\n## 公式与推导\n\n$$\n\n$$\n\n## 示例\n\n## 参考资料\n',
};
export function contentOf(value: any) {
  return {
    title: value.title,
    summary: value.summary,
    markdown: value.markdown,
    template: value.template,
    baseRevisionId: value.baseRevisionId,
    changeNote: value.changeNote,
    relations: value.relations.map((r: any) => ({
      type: r.type,
      targetPageId: r.targetPageId,
      ...(r.conditions ? { conditions: r.conditions } : {}),
      ...(r.explanation ? { explanation: r.explanation } : {}),
      ...(r.evidence ? { evidence: r.evidence } : {}),
    })),
  };
}
