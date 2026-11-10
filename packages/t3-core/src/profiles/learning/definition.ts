import type { WorkspaceProfileDefinition } from "../definition";

export const LEARNING_PROFILE_DEFINITION: WorkspaceProfileDefinition = {
  id: "learning",
  label: "Обучение",
  description: "Цели, компетенции, дефициты, маршруты, задания и рефлексия.",
  logoText: "L·WX",
  accent: "#6366f1",
  sections: [
    {
      id: "goals",
      title: "Цели",
      schemaIds: ["learning-goal"],
      emptyTitle: "Целей нет",
      emptyDescription:
        "Цели появятся после работы в сервисах домена или импорта пакета.",
    },
    {
      id: "competencies",
      title: "Компетенции",
      schemaIds: ["competency"],
      emptyTitle: "Компетенций нет",
      emptyDescription:
        "Компетенции появятся после работы в сервисах домена или импорта пакета.",
    },
    {
      id: "gaps",
      title: "Дефициты",
      schemaIds: ["competency-gap"],
      emptyTitle: "Дефицитов нет",
      emptyDescription:
        "Дефициты появятся после диагностики в сервисах домена.",
    },
    {
      id: "routes",
      title: "Маршруты",
      schemaIds: ["career-route", "learning-route"],
      emptyTitle: "Маршрутов нет",
      emptyDescription:
        "Маршруты появятся после планирования в сервисах домена.",
    },
    {
      id: "tasks",
      title: "Задания",
      schemaIds: ["task"],
      emptyTitle: "Заданий нет",
      emptyDescription: "Задания появятся после публикации в сервисах домена.",
    },
    {
      id: "practice",
      title: "Практика",
      schemaIds: ["practice-result"],
      emptyTitle: "Результатов практики нет",
      emptyDescription:
        "Результаты практики появятся после прохождения тренировок.",
    },
    {
      id: "reflection",
      title: "Рефлексия",
      schemaIds: ["reflection"],
      emptyTitle: "Записей рефлексии нет",
      emptyDescription:
        "Рефлексия появится после работы в сервисах домена.",
    },
  ],
  unknownObjectsSection: {
    title: "Прочие объекты",
    description: "Объекты, не относящиеся к типам профиля Learning.",
  },
};
