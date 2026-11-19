// 색상 팔레트의 이름 목록. 실제 색 값은 palette.css 에만 있습니다.
export const PALETTE = [
  {id: 'red', name: '빨강'},
  {id: 'orange', name: '주황'},
  {id: 'yellow', name: '노랑'},
  {id: 'green', name: '초록'},
  {id: 'teal', name: '청록'},
  {id: 'blue', name: '파랑'},
  {id: 'purple', name: '보라'},
  {id: 'gray', name: '회색'},
] as const;

export type PaletteId = (typeof PALETTE)[number]['id'];
export const paletteName = (id: PaletteId) => PALETTE.find(p => p.id === id)?.name ?? '';
