/**
 * 单遍 HTML 实体解码（只解码一次，不递归）。
 *
 * 用于还原旧版后端入库时被 sanitize-html 转义的 markdown 内容
 * （`>` `<` `&` → `&gt;` `&lt;` `&amp;`）。单遍解码是单遍编码的逆操作：
 * `&amp;gt;` → `&gt;`、`&gt;` → `>`，不会递归解码用户原本输入的实体。
 */
export function decodeEntities(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|#\d+|#x[\da-fA-F]+);/g,
    (match: string, name: string) => {
      switch (name) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        default:
          if (name.startsWith('#')) {
            const hex = name[1] === 'x' || name[1] === 'X';
            const code = hex
              ? parseInt(name.slice(2), 16)
              : parseInt(name.slice(1), 10);
            try {
              return String.fromCodePoint(code);
            } catch {
              return match;
            }
          }
          return match;
      }
    },
  );
}
