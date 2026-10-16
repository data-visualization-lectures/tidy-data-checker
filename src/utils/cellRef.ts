export function toColLetter(col: number): string {
  let s = '';
  let c = col + 1;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

export function toA1(row: number, col: number): string {
  return `${toColLetter(col)}${row + 1}`;
}

export function rangeToA1(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): string {
  const start = toA1(startRow, startCol);
  const end = toA1(endRow, endCol);
  if (start === end) {
    return start;
  }
  return `${start}:${end}`;
}
