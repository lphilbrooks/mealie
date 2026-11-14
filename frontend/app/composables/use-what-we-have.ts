import { computed, reactive, ref, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useUserApi } from "~/composables/api";
import type { IngredientFoodOut } from "~/lib/api/types/recipe";

export type AvailabilityFilter = "all" | "have" | "out";

/** How many rows are added each time the list is extended */
export const WHAT_WE_HAVE_PAGE_SIZE = 150;

function normalize(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * State for the "What we have" page: every food in the group, with the household's on hand flag
 * for each, searchable and filterable, and a way to set the flag one food at a time.
 *
 * The flags are Mealie's existing household on hand records. Nothing is stored anywhere else, so
 * the shopping list, "I Made This" and the Recipe Finder all read and write the same thing.
 */
export function useWhatWeHave(householdSlug: MaybeRefOrGetter<string | undefined>) {
  const api = useUserApi();

  const foods = ref<IngredientFoodOut[]>([]);
  const ready = ref(false);
  const refreshing = ref(false);
  const loadFailed = ref(false);
  const lastUpdated = ref<Date | null>(null);

  const search = ref("");
  const filter = ref<AvailabilityFilter>("all");
  const onlyInRecipes = ref(true);
  const limit = ref(WHAT_WE_HAVE_PAGE_SIZE);

  /** Foods with a save in flight, and the value being saved */
  const saving = reactive(new Map<string, boolean>());
  /** Foods whose last save failed, and the value that could not be saved */
  const failed = reactive(new Map<string, boolean>());
  /** Foods changed since the filter was last picked; they stay listed so a mis-tap can be undone */
  const pinned = reactive(new Set<string>());

  // Counts every local change. A refresh that started before a food's latest change must not
  // overwrite it, or the row would flick back to the old value until the next refresh.
  let changeCounter = 0;
  const lastChange = new Map<string, number>();

  function isOnHand(food: IngredientFoodOut): boolean {
    const slug = toValue(householdSlug);
    return !!slug && (food.householdsWithIngredientFood ?? []).includes(slug);
  }

  function applyOnHand(food: IngredientFoodOut, value: boolean) {
    const slug = toValue(householdSlug);
    if (!slug) {
      return;
    }
    const others = (food.householdsWithIngredientFood ?? []).filter(s => s !== slug);
    food.householdsWithIngredientFood = value ? [...others, slug] : others;
  }

  /**
   * Loads every food. Called on open, on a timer, and when the page becomes visible again, so
   * changes made by the other household member show up without a manual reload.
   */
  async function refresh(): Promise<boolean> {
    if (refreshing.value) {
      return false;
    }

    refreshing.value = true;
    const startedAt = changeCounter;
    try {
      const { data } = await api.foods.getAll(1, -1, { orderBy: "name", orderDirection: "asc" });
      if (!data?.items) {
        loadFailed.value = true;
        return false;
      }

      const current = new Map(foods.value.map(food => [food.id, food]));
      foods.value = data.items.map((incoming) => {
        const local = current.get(incoming.id);
        const changedSince = (lastChange.get(incoming.id) ?? 0) > startedAt;
        if (local && (saving.has(incoming.id) || changedSince)) {
          // keep what was just tapped; the server copy predates it
          return { ...incoming, householdsWithIngredientFood: local.householdsWithIngredientFood };
        }
        return incoming;
      });

      loadFailed.value = false;
      lastUpdated.value = new Date();
      return true;
    }
    finally {
      refreshing.value = false;
      ready.value = true;
    }
  }

  /**
   * Sets one food's on hand flag for the household. The row changes at once and is put back if
   * the save fails. Returns false if the save failed.
   */
  async function setOnHand(foodId: string, value: boolean): Promise<boolean> {
    const food = foods.value.find(f => f.id === foodId);
    if (!food || saving.has(foodId)) {
      return false;
    }

    if (isOnHand(food) === value && !failed.has(foodId)) {
      return true;
    }

    const previous = isOnHand(food);
    failed.delete(foodId);
    saving.set(foodId, value);
    pinned.add(foodId);
    lastChange.set(foodId, ++changeCounter);
    applyOnHand(food, value);

    let ok: boolean;
    try {
      const { error } = value
        ? await api.households.addFoodsOnHand([foodId])
        : await api.households.removeFoodsOnHand([foodId]);
      ok = !error;
    }
    catch {
      ok = false;
    }

    // the list may have been reloaded while saving, so look the food up again
    const latest = foods.value.find(f => f.id === foodId);
    lastChange.set(foodId, ++changeCounter);
    saving.delete(foodId);
    if (!ok) {
      if (latest) {
        applyOnHand(latest, previous);
      }
      failed.set(foodId, value);
    }
    return ok;
  }

  /** Tries again to save a change that failed */
  function retry(foodId: string): Promise<boolean> {
    const value = failed.get(foodId);
    if (value === undefined) {
      return Promise.resolve(true);
    }
    return setOnHand(foodId, value);
  }

  function setFilter(value: AvailabilityFilter) {
    filter.value = value;
    pinned.clear();
    limit.value = WHAT_WE_HAVE_PAGE_SIZE;
  }

  function showMore() {
    limit.value += WHAT_WE_HAVE_PAGE_SIZE;
  }

  /** Whether any food is used in a recipe; if none is, limiting the list to those would hide everything */
  const anyInRecipes = computed(() => foods.value.some(food => (food.recipeCount ?? 0) > 0));

  /** Foods the page is about: all of them, or only the ones the group's recipes use */
  const scopedFoods = computed(() => {
    if (!onlyInRecipes.value || !anyInRecipes.value) {
      return foods.value;
    }
    // a food marked on hand always counts, or it could never be found to be marked run out
    return foods.value.filter(food => (food.recipeCount ?? 0) > 0 || isOnHand(food) || pinned.has(food.id));
  });

  const counts = computed(() => {
    let have = 0;
    for (const food of scopedFoods.value) {
      if (isOnHand(food)) {
        have++;
      }
    }
    return { all: scopedFoods.value.length, have, out: scopedFoods.value.length - have };
  });

  const matchingFoods = computed(() => {
    const term = normalize(search.value);
    return scopedFoods.value.filter((food) => {
      if (!pinned.has(food.id)) {
        if (filter.value === "have" && !isOnHand(food)) {
          return false;
        }
        if (filter.value === "out" && isOnHand(food)) {
          return false;
        }
      }

      if (!term) {
        return true;
      }
      return (
        normalize(food.name).includes(term)
        || normalize(food.pluralName).includes(term)
        || (food.aliases ?? []).some(alias => normalize(alias.name).includes(term))
      );
    });
  });

  const visibleFoods = computed(() => matchingFoods.value.slice(0, limit.value));
  const hiddenCount = computed(() => Math.max(0, matchingFoods.value.length - limit.value));

  return {
    // state
    ready,
    refreshing,
    loadFailed,
    lastUpdated,
    search,
    filter,
    onlyInRecipes,
    saving,
    failed,

    // derived
    anyInRecipes,
    counts,
    matchingFoods,
    visibleFoods,
    hiddenCount,

    // actions
    isOnHand,
    refresh,
    setOnHand,
    retry,
    setFilter,
    showMore,
  };
}
