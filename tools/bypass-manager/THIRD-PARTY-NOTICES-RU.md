# Состав поставки Bypass Manager и исходные лицензии

Windows-приложение Bypass Manager использует неизменённые бинарные компоненты сторонних проектов. Собственный исходный код приложения не меняет их прошивку, DLL или Lua.

- **zapret2 / winws2 и Lua**, автор bol-van: MIT License, Copyright (c) 2016–2026 bol-van. Источник: https://github.com/bol-van/zapret2 , текст лицензии: https://github.com/bol-van/zapret2/blob/master/docs/LICENSE.txt . Оригинальные файлы Windows-архива берутся из репозитория https://github.com/bol-van/zapret-win-bundle на закреплённом коммите `6b4375fa04f6bd7017eec379e16e462d3ea8df66` и проверяются по Git blob SHA.
- **WinDivert.dll и WinDivert64.sys**, автор basil00 и участники: GNU LGPL версии 3 либо GNU GPL версии 2, на выбор получателя. Источник и соответствующий текст лицензии: https://github.com/basil00/WinDivert/tree/v2.2.2 . Полный файл `WinDivert-LICENSE.txt` помещается в каталог `LICENSES/` ZIP рядом с программой. Оригинальный DLL и драйвер поставляются без изменений.
- **cygwin1.dll**: Cygwin Runtime (LGPL версии 3 или новее с исключением для связывания), https://cygwin.com/licensing.html . Копия LGPLv3 включена в файл WinDivert-LICENSE.txt, поставляемый вместе с программой. Исходный код Cygwin доступен: https://cygwin.com/ . Библиотека включена в оригинальную Windows-сборку zapret-win-bundle.

Текст лицензии MIT для оригинального zapret2:

> Copyright (c) 2016-2026 bol-van
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Дистрибутив содержит исходный файл лицензии WinDivert, сведения о происхождении и ссылки на исходные проекты. Юридические обязательства при массовом распространении бинарных LGPL-компонентов, включая доступ к соответствующему исходному коду конкретных сборок, требуют отдельной окончательной проверки. Нельзя считать данный документ завершённой юридической экспертизой.

**Функциональное ограничение:** наличие и загрузка драйвера не доказывают успешный обход блокировок. Проверка общедоступных HTTPS-сервисов — только проверка качества исходящего канала *самого приложения*, не маскировка IP и не подтверждение работы каждого сайта или браузера.
