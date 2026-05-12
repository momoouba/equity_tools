/**
 * 一次性脚本：在新闻舆情相关 SQL 中，为 invested_enterprises 增加 data_app_name 过滤。
 * 不修改 routes/enterprises.js（该路由使用参数化 data_app_name 条件）。
 */
const fs = require('fs');
const path = require('path');

const newsRoot = path.join(__dirname, '..');
const files = [
  path.join(newsRoot, 'server/routes/news.js'),
  path.join(newsRoot, 'server/routes/newsAnalysis.js'),
  path.join(newsRoot, 'server/routes/newsShare.js'),
  path.join(newsRoot, 'server/utils/newsAnalysis.js'),
  path.join(newsRoot, 'server/utils/scheduledEmailTasks.js'),
];

function patchContent(content) {
  let c = content;
  // FROM invested_enterprises [alias]? whitespace WHERE（尚未带 COALESCE 过滤时）
  c = c.replace(
    /FROM invested_enterprises(\s+[a-zA-Z_][a-zA-Z0-9_]*)?(\s*\n\s*|\s+)WHERE(?!\s*\(COALESCE\()/g,
    (full, alias, sep) => {
      const a = (alias || '').trim();
      const cond = a
        ? `(COALESCE(${a}.data_app_name, '新闻舆情') = '新闻舆情')`
        : `(COALESCE(data_app_name, '新闻舆情') = '新闻舆情')`;
      return `FROM invested_enterprises${alias || ''}${sep}WHERE ${cond} AND `;
    }
  );
  return c;
}

for (const fp of files) {
  const before = fs.readFileSync(fp, 'utf8');
  const after = patchContent(before);
  if (after !== before) {
    fs.writeFileSync(fp, after, 'utf8');
    console.log('patched', path.relative(newsRoot, fp));
  } else {
    console.log('skip (no change)', path.relative(newsRoot, fp));
  }
}
