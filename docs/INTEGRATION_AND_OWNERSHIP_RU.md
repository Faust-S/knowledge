# IWXA — публичная карта объединения и владельцев (03.11.2026)

**Статус:** организационная миграция, объединение истории открытых веток и один синтетический совместимый fixture. Не подтверждает private product readiness.

| Направление | Единственный владелец кода | Здесь допустимо | Не переносить |
|---|---|---|---|
| Специализированный агент | `Faust-S/knowledge/catalog/solutions` | конкретные workflow, источники, лицензии, сравнение с Skills | платформу Goose/Dify/CrewAI как «агента», другой Core |
| Task/Goal/Graph/Skills/Runtime/Result | `Faust-S/iwxa-personal-agent` | открытый Task→draft Result fixture, проверка источника | личные данные, Task/Graph/Memory/Store, Model Provider |
| Task Discovery/U1/Cross-Lab/Context | `Faust-S/iwxa` | разрешённые реальные исследования, независимые корпуса/метрики | приватные сведения, дубликат Engine/Compiler |
| R5-C4, Reconciliation, Access, .iwxa | `Faust-S/T3` | синтетические contract probes без обязательного T3 source | AccessRegistry, LocalAccessStore, JIT, Journal, новый IAM |
| Корпоративная деятельность | Admin Center, референс T3 | result/review contracts, видимые receipt requirements | личную память и чужие полномочия |
| Лицензии, релизы | Publisher, референс T3 | публичные критерии проверки выпуска | signer/issuer private keys, новую коммерческую власть |
| Семантика и домены | T0/T1/Protocol/T2 + owning products | открытые совместимые примеры при подтверждённой лицензии | вторые нормативные API/Kernel |

**Три разных действия:** PA создаёт личный Result и по решению человека переносит его; Admin рассматривает Result, принимает отдельное организационное решение и применяет через свой Host; Publisher подписывает релиз/лицензию и не принимает чужие результаты. Одно действие не выдаёт полномочий другого. Работают независимо и локально, без обязательного сервера.

**R5-C4:** свежесть *известного* подписанного статуса, issuer sequence, terminal-history/tombstones, перенос и полный импорт. Остаётся в T3, для PA — узкий статусный consumer, для Admin — issuer/Host, для Publisher — отдельный имеющийся license-status verifier. Не объявлять нативную квалификацию всей текущей R5-C4 и не требовать R5-C4 для обычной личной Task. Недоставленные отзывы остаются UNKNOWN.

**Порядок:** open QA+catalog merge → open test fixture и CI → закрытая координация Task/Agent/Skill/Context/Runtime → адресный адаптер Result→.iwxa→Admin через существующий T3 → независимый Publisher TEST license. Cross-Lab/Task Discovery сохраняют source owner в iwxa; переносить отдельно только действительно разрешённые open datasets/algorithms, сначала проверить независимую полезность. Не смешивать QA исходников с установленным Windows UI.
