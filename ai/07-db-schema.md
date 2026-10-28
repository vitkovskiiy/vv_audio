# 07 — Схема БД: рішення

## [Студент] Промпт (дослівно)

> давай сделаем схему бд примем решение наводи примеры а я буду принимать решения

## [AI] Вихід

12 точок рішення (D1–D12) з варіантами, плюсами/мінусами й рекомендацією; ER-діаграма рекомендованого варіанта.

## [Студент] Рішення (дослівно)

> д1 а д2 б д3 а д4 а д5 а д6 б д7 б д8 а д9 б д10 а д11 а д12 а

| # | Питання | Рішення |
|---|---|---|
| D1 | Тип ідентифікаторів | UUIDv7 (`uuidv7()` у PostgreSQL 18) |
| D2 | Код кімнати | `id uuid` PK + окрема унікальна колонка `code` |
| D3 | Ролі | `room_members.role ∈ {owner, dj, listener}` + унікальний індекс «один власник на кімнату» |
| D4 | Перелічення | `text` + `CHECK` |
| D5 | Преміум / адмін | `users.plan ∈ {free, premium}` + `users.is_admin` |
| D6 | Дані треку | окрема таблиця `tracks`, унікальна `(source, ref)`; `queue_items.track_id`, `favorites.track_id` |
| D7 | Порядок черги 2:1 | зберігати `added_at` + `is_premium` на момент додавання; порядок — віконною функцією при читанні |
| D8 | Видалені / зіграні | м'яке видалення: `status ∈ {queued, playing, played, removed}` |
| D9 | Стан відтворення | окрема таблиця 1:1 `room_playback` |
| D10 | Запити на видалення | `removal_requests.status ∈ {pending, approved, rejected, obsolete}` + унікальний індекс на відкритий запит |
| D11 | Системні повідомлення | у `messages` з `kind ∈ {user, system}`, `user_id NULL` для системних |
| D12 | Ключі ідемпотентності | зберігати 24 години, періодичне очищення |

## Підсумкова ER-діаграма

```mermaid
erDiagram
  users ||--o{ sessions : has
  users ||--o{ room_members : joins
  rooms ||--o{ room_members : has
  rooms ||--|| room_playback : state
  rooms ||--o{ queue_items : queue
  tracks ||--o{ queue_items : is
  users ||--o{ queue_items : added_by
  queue_items ||--o{ removal_requests : about
  users ||--o{ removal_requests : requested_by
  rooms ||--o{ messages : chat
  users ||--o{ favorites : saves
  tracks ||--o{ favorites : saved
  users ||--o{ idempotency_keys : owns

  users { uuid id PK; text username; text username_key UK; text pass_hash; text plan; bool is_admin }
  sessions { text token_hash PK; uuid user_id FK; timestamptz expires_at }
  rooms { uuid id PK; text code UK; timestamptz created_at }
  room_members { uuid room_id PK; uuid user_id PK; text role; timestamptz last_visit }
  room_playback { uuid room_id PK; uuid current_item_id FK; bool is_playing; real position_sec; timestamptz updated_at }
  tracks { uuid id PK; text source; text ref; text title; text artist; text thumbnail }
  queue_items { uuid id PK; uuid room_id FK; uuid track_id FK; uuid added_by FK; bool is_premium; text status; timestamptz added_at }
  removal_requests { uuid id PK; uuid queue_item_id FK; uuid requested_by FK; text status; uuid decided_by FK; timestamptz decided_at }
  messages { uuid id PK; uuid room_id FK; uuid user_id FK; text kind; text text; timestamptz created_at }
  favorites { uuid user_id PK; uuid track_id PK; timestamptz created_at }
  idempotency_keys { uuid user_id PK; text key PK; text request_hash; int status_code; jsonb response; timestamptz created_at }
```
