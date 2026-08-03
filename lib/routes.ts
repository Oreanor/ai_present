// Ссылки между окнами. В статической сборке экспорт даёт плоские
// control.html / present.html, и на file:// путь без расширения не
// разрешается — Chrome покажет листинг каталога вместо страницы.
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_BUILD === '1';

export const routes = {
  control: IS_STATIC ? './control.html' : '/control',
  present: IS_STATIC ? './present.html' : '/present',
};
