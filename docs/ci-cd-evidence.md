# Завдання 4 — докази реальних прогонів

Факти й посилання на прогони GitHub Actions. Висновки — у DEFENSE студента.

## CI блокує брудний PR

| Що                                                                                  | Результат                                                                                                                                                 | Доказ                                                                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| PR #5 з навмисно зламаним unit-тестом (`server/test/readyz.test.ts`, `503` → `200`) | `check` червоний: `AssertionError: expected 503 to be 200`, `1 failed \| 72 passed (73)`; решта 4 перевірки зелені; стан PR `BLOCKED`; закрито без мерджа | [PR #5](https://github.com/vitkovskiiy/vv_audio/pull/5), [прогін](https://github.com/vitkovskiiy/vv_audio/actions/runs/45354589822) |
| Прямий `git push origin main`                                                       | `GH013: Repository rule violations` — `Changes must be made through a pull request`, `5 of 5 required status checks are expected`; `[remote rejected]`    | вивід `git push` (нижче)                                                                                                            |
| PR #4 (Завдання 4)                                                                  | 5/5 перевірок зелені з першого прогону                                                                                                                    | [PR #4](https://github.com/vitkovskiiy/vv_audio/pull/4)                                                                             |

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 5 of 5 required status checks are expected.
 ! [remote rejected] main -> main (push declined due to repository rule violations)
```

Правило `main: PR only, green CI, squash`: лише PR, обов'язкові `check`, `integration`, `e2e`, `docker`, `pr-title`, гілка актуальна з `main`, лише squash, без обходу (навіть для власника).

## CD деплоїть на стейдж

Стейдж: <https://vv-audio-staging.onrender.com> (Render, образ із GHCR; PostgreSQL — Neon).

| Що                                                 | Результат                                                                                                                    | Доказ                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Перший прогін CD після мерджа PR #4                | образ `ghcr.io/vitkovskiiy/vv_audio:f9a00b3…` опубліковано; крок deploy hook упав — сервіс Render ще не створено (очікувано) | [прогін, спроба 1](https://github.com/vitkovskiiy/vv_audio/actions/runs/45356326412/attempts/1) |
| Перший старт на Render з помилковим `DATABASE_URL` | `getaddrinfo ENOTFOUND …`, `startup failed`, `Exited with status 1`; трафік на зламану версію не пішов                       | лог деплою Render (скриншот у DEFENSE)                                                          |
| Повтор CD після налаштування Render                | `deploy requested for …:f9a00b3…` → `staging is on f9a00b3…`                                                                 | [прогін, спроба 2](https://github.com/vitkovskiiy/vv_audio/actions/runs/45356326412)            |
| `/readyz`, `/version` на стейджі                   | `{"status":"ready","checks":{"postgres":"ok"}}`; `{"sha":"f9a00b3bbb325df3d24f7c367b69c65eb792b241", …}`                     | `curl`                                                                                          |
