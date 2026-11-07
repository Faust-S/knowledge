# Activity Research — IWXA

Исследование реконструкции деятельности по разрешённым исходным записям. Не отдельный Activity Engine, Task Engine, хранилище, источник человеческой оценки или runtime.

**Действующий путь Scene 01 (Solve4X):**

1. [C12–C17 source-bound handoff для K03 и K05](SOLVE4X_C12_C17_K03_K05_HANDOFF_2026-11-05_RU.md) — исходные SHA/локаторы, примеры API, ограничения передаваемой проекции, отсутствие Task/human gold.
2. [C17 blind review](SOLVE4X_C17_BLIND_REVIEW_2026-11-05_RU.md) — протокол независимого просмотра в owner-local Label Studio. `prepare()`, `blank_receipt()`, `score()` не подтверждают независимую человеческую оценку без настоящих отзывов.
3. [Основной отчёт replay](SOLVE4X_MULTICHANNEL_REPLAY_2026-11-04_RU.md) — исходные C11–C16, условия воспроизводимости и clock uncertainty.
4. [Миграционный handoff](HANDOFF_NEW_CHAT_2026-11-04_RU.md) — происхождение исследований, ограничения владельцев U1/P01/K03/K05.

**Read-only вход:** `solve4x_source_bound_handoff.prepare_owner_local(video_bytes,sensor_bytes,ui_bytes,reed_bytes)` только с оригинальными байтами SHA-pinned Scene 01; `public_summary(private_packet,source_files=...)` выдаёт лишь обезличенные агрегаты. `reconcile_with_existing_reports()` сверяет их с действующими C13/C14.

**Воспроизведение:**

```sh
python3 -m unittest discover -s research/activity-research/tests -p 'test_solve4x_source_bound_handoff.py' -v
python3 -m unittest discover -s research/activity-research/tests -p 'test_solve4x_c17_blind_review.py' -v
python3 research/activity-research/solve4x_cross_source_coverage.py --out /tmp/solve4x-c12-aggregate.json
```

Последняя команда обращается к pinned публичному Solve4X; при недоступности или SHA-drift — HOLD, не PASS. Публичный workflow `activity-solve4x-source-preflight.yml` не публикует оригинальные события, видео, имена, raw source values или owner-local review.

Для K03/K05 требуется отдельная авторизованная consumer-side адаптация к их действующим контрактам. Не считать sensor OCEL/raw reed независимыми человеческими наблюдателями. `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.

**C17 video scope preflight:** `public_media_window_sanity()` условно сравнивает исходные окна 23/6/3 с опубликованной продолжительностью MP4 без скачивания медиаданных или привязки кадров к OCEL; агрегат находится в `c12.probe()['c17_published_media_window_screen']`. Отрицательные тесты проверяют контекст у границ, нечисловую длительность, неизвестный timezone и недопустимый интервал. Подробнее: [протокол C17](SOLVE4X_C17_BLIND_REVIEW_2026-11-05_RU.md). До owner-local проверки видео `ready_for_human_review=false`.

**C17 owner-local MP4 gate:** `solve4x_c17_blind_review.py media-verify` принимает оригинальный приватный `scene01.mp4`, frozen plan SHA и pinned ZIP-directory index; проверяет исходный файл (size/CRC/SHA/FFprobe) и рассчитанные окна без генерации клипов. Публичный CI проверяет только **синтетическую** локальную последовательность и доступность metadata, не скачивает MP4. Подробности в [протоколе C17](SOLVE4X_C17_BLIND_REVIEW_2026-11-05_RU.md).
