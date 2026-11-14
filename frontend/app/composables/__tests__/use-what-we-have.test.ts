import { beforeEach, describe, expect, test, vi } from "vitest";
import { ref } from "vue";
import { useWhatWeHave, WHAT_WE_HAVE_PAGE_SIZE } from "../use-what-we-have";
import type { IngredientFoodOut } from "~/lib/api/types/recipe";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  addFoodsOnHand: vi.fn(),
  removeFoodsOnHand: vi.fn(),
}));

vi.mock("~/composables/api", () => ({
  useUserApi: () => ({
    foods: { getAll: mocks.getAll },
    households: { addFoodsOnHand: mocks.addFoodsOnHand, removeFoodsOnHand: mocks.removeFoodsOnHand },
  }),
}));

const HOUSEHOLD = "family";
const OTHER_HOUSEHOLD = "neighbours";

function food(id: string, overrides: Partial<IngredientFoodOut> = {}): IngredientFoodOut {
  return {
    id,
    name: id,
    pluralName: null,
    description: "",
    extras: {},
    labelId: null,
    aliases: [],
    substitutions: [],
    householdsWithIngredientFood: [],
    label: null,
    recipeCount: 1,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function serverReturns(items: IngredientFoodOut[]) {
  // a fresh copy each time, as a real response would be
  mocks.getAll.mockImplementation(async () => ({ data: { items: structuredClone(items) }, error: null }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const OK = { data: { message: "", error: false }, error: null };
const FAILED = { data: null, error: new Error("Network Error") };

describe("useWhatWeHave", () => {
  const householdSlug = ref<string | undefined>(HOUSEHOLD);

  function names(page: ReturnType<typeof useWhatWeHave>) {
    return page.visibleFoods.value.map(f => f.name);
  }

  function onHand(page: ReturnType<typeof useWhatWeHave>, id: string) {
    return page.isOnHand(page.matchingFoods.value.find(f => f.id === id)!);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    householdSlug.value = HOUSEHOLD;
    mocks.addFoodsOnHand.mockResolvedValue(OK);
    mocks.removeFoodsOnHand.mockResolvedValue(OK);
  });

  test("reads on hand from the user's own household only", async () => {
    serverReturns([
      food("eggs", { householdsWithIngredientFood: [HOUSEHOLD] }),
      food("milk", { householdsWithIngredientFood: [OTHER_HOUSEHOLD] }),
      food("rice"),
    ]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(onHand(page, "eggs")).toBe(true);
    expect(onHand(page, "milk")).toBe(false);
    expect(page.counts.value).toEqual({ all: 3, have: 1, out: 2 });
  });

  test("filters by availability", async () => {
    serverReturns([food("eggs", { householdsWithIngredientFood: [HOUSEHOLD] }), food("milk"), food("rice")]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    page.setFilter("have");
    expect(names(page)).toEqual(["eggs"]);

    page.setFilter("out");
    expect(names(page)).toEqual(["milk", "rice"]);

    page.setFilter("all");
    expect(names(page)).toEqual(["eggs", "milk", "rice"]);
  });

  test("searches names, plural names and aliases, ignoring case and accents", async () => {
    serverReturns([
      food("1", { name: "Crème fraîche" }),
      food("2", { name: "tomato", pluralName: "tomatoes" }),
      food("3", { name: "coriander", aliases: [{ name: "Cilantro" }] }),
    ]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    page.search.value = "creme";
    expect(names(page)).toEqual(["Crème fraîche"]);

    page.search.value = "TOMATOES";
    expect(names(page)).toEqual(["tomato"]);

    page.search.value = "cilan";
    expect(names(page)).toEqual(["coriander"]);

    page.search.value = "nothing like this";
    expect(names(page)).toEqual([]);
  });

  test("hides foods no recipe uses unless they are on hand or the option is off", async () => {
    serverReturns([
      food("eggs"),
      food("saffron", { recipeCount: 0 }),
      food("truffle", { recipeCount: 0, householdsWithIngredientFood: [HOUSEHOLD] }),
    ]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(names(page)).toEqual(["eggs", "truffle"]);

    page.onlyInRecipes.value = false;
    expect(names(page)).toEqual(["eggs", "saffron", "truffle"]);
  });

  test("shows every food when no recipe uses any of them", async () => {
    serverReturns([food("eggs", { recipeCount: 0 }), food("milk", { recipeCount: 0 })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(page.anyInRecipes.value).toBe(false);
    expect(names(page)).toEqual(["eggs", "milk"]);
  });

  test("marks a food on hand for the household and keeps other households' flags", async () => {
    serverReturns([food("milk", { householdsWithIngredientFood: [OTHER_HOUSEHOLD] })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(await page.setOnHand("milk", true)).toBe(true);

    expect(mocks.addFoodsOnHand).toHaveBeenCalledExactlyOnceWith(["milk"]);
    expect(mocks.removeFoodsOnHand).not.toHaveBeenCalled();
    expect(page.matchingFoods.value[0].householdsWithIngredientFood.sort()).toEqual([HOUSEHOLD, OTHER_HOUSEHOLD]);
    expect(page.saving.size).toBe(0);
    expect(page.failed.size).toBe(0);
  });

  test("marks a food run out for the household only", async () => {
    serverReturns([food("milk", { householdsWithIngredientFood: [HOUSEHOLD, OTHER_HOUSEHOLD] })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(await page.setOnHand("milk", false)).toBe(true);

    expect(mocks.removeFoodsOnHand).toHaveBeenCalledExactlyOnceWith(["milk"]);
    expect(page.matchingFoods.value[0].householdsWithIngredientFood).toEqual([OTHER_HOUSEHOLD]);
  });

  test("does not send a request when the food is already in the chosen state", async () => {
    serverReturns([food("eggs", { householdsWithIngredientFood: [HOUSEHOLD] })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(await page.setOnHand("eggs", true)).toBe(true);
    expect(mocks.addFoodsOnHand).not.toHaveBeenCalled();
  });

  test("shows the change while it saves, and ignores more taps until it has", async () => {
    serverReturns([food("milk")]);
    const pending = deferred<typeof OK>();
    mocks.addFoodsOnHand.mockReturnValueOnce(pending.promise);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    const save = page.setOnHand("milk", true);
    expect(onHand(page, "milk")).toBe(true);
    expect(page.saving.get("milk")).toBe(true);

    expect(await page.setOnHand("milk", false)).toBe(false);
    expect(mocks.removeFoodsOnHand).not.toHaveBeenCalled();

    pending.resolve(OK);
    expect(await save).toBe(true);
    expect(page.saving.size).toBe(0);
    expect(onHand(page, "milk")).toBe(true);
  });

  test("puts the food back and records the failure when the save fails", async () => {
    serverReturns([food("milk")]);
    mocks.addFoodsOnHand.mockResolvedValueOnce(FAILED);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(await page.setOnHand("milk", true)).toBe(false);

    expect(onHand(page, "milk")).toBe(false);
    expect(page.failed.get("milk")).toBe(true);
    expect(page.saving.size).toBe(0);
  });

  test("treats a thrown request as a failed save", async () => {
    serverReturns([food("milk", { householdsWithIngredientFood: [HOUSEHOLD] })]);
    mocks.removeFoodsOnHand.mockRejectedValueOnce(new Error("boom"));
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(await page.setOnHand("milk", false)).toBe(false);
    expect(onHand(page, "milk")).toBe(true);
    expect(page.failed.get("milk")).toBe(false);
  });

  test("retries a failed save with the value that was chosen", async () => {
    serverReturns([food("milk")]);
    mocks.addFoodsOnHand.mockResolvedValueOnce(FAILED);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();
    await page.setOnHand("milk", true);

    expect(await page.retry("milk")).toBe(true);

    expect(mocks.addFoodsOnHand).toHaveBeenCalledTimes(2);
    expect(onHand(page, "milk")).toBe(true);
    expect(page.failed.size).toBe(0);
  });

  test("keeps a changed food listed until the filter is picked again", async () => {
    serverReturns([
      food("eggs", { householdsWithIngredientFood: [HOUSEHOLD] }),
      food("milk", { householdsWithIngredientFood: [HOUSEHOLD] }),
    ]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();
    page.setFilter("have");

    await page.setOnHand("milk", false);
    expect(names(page)).toEqual(["eggs", "milk"]);

    page.setFilter("have");
    expect(names(page)).toEqual(["eggs"]);
  });

  test("picks up the other household member's changes on refresh", async () => {
    serverReturns([food("milk")]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();
    expect(onHand(page, "milk")).toBe(false);

    serverReturns([food("milk", { householdsWithIngredientFood: [HOUSEHOLD] })]);
    await page.refresh();

    expect(onHand(page, "milk")).toBe(true);
  });

  test("a refresh that started before a change does not undo it", async () => {
    serverReturns([food("milk")]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    // the refresh is sent, then the user taps and the save finishes before the refresh comes back
    const stale = deferred<{ data: { items: IngredientFoodOut[] }; error: null }>();
    mocks.getAll.mockReturnValueOnce(stale.promise);
    const refreshing = page.refresh();
    await page.setOnHand("milk", true);
    stale.resolve({ data: { items: [food("milk")] }, error: null });
    await refreshing;

    expect(onHand(page, "milk")).toBe(true);
  });

  test("a refresh during a save keeps what was tapped", async () => {
    serverReturns([food("milk")]);
    const pending = deferred<typeof OK>();
    mocks.addFoodsOnHand.mockReturnValueOnce(pending.promise);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    const save = page.setOnHand("milk", true);
    await page.refresh();
    expect(onHand(page, "milk")).toBe(true);

    pending.resolve(OK);
    await save;
    expect(onHand(page, "milk")).toBe(true);
  });

  test("keeps the old list and flags it when a refresh fails", async () => {
    serverReturns([food("milk", { householdsWithIngredientFood: [HOUSEHOLD] })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    mocks.getAll.mockResolvedValueOnce({ data: null, error: new Error("Network Error") });
    expect(await page.refresh()).toBe(false);

    expect(page.loadFailed.value).toBe(true);
    expect(names(page)).toEqual(["milk"]);

    serverReturns([food("milk")]);
    expect(await page.refresh()).toBe(true);
    expect(page.loadFailed.value).toBe(false);
  });

  test("treats nothing as on hand without a household", async () => {
    householdSlug.value = undefined;
    serverReturns([food("milk", { householdsWithIngredientFood: [HOUSEHOLD] })]);
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(onHand(page, "milk")).toBe(false);
  });

  test("lists foods a page at a time", async () => {
    serverReturns(Array.from({ length: WHAT_WE_HAVE_PAGE_SIZE + 10 }, (_, i) => food(`food-${i}`)));
    const page = useWhatWeHave(householdSlug);
    await page.refresh();

    expect(page.visibleFoods.value).toHaveLength(WHAT_WE_HAVE_PAGE_SIZE);
    expect(page.hiddenCount.value).toBe(10);

    page.showMore();
    expect(page.visibleFoods.value).toHaveLength(WHAT_WE_HAVE_PAGE_SIZE + 10);
    expect(page.hiddenCount.value).toBe(0);
  });
});
