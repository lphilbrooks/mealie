<template>
  <v-container class="narrow-container what-we-have">
    <header class="wwh-header">
      <v-icon
        size="40"
        color="primary"
      >
        {{ $globals.icons.fridge }}
      </v-icon>
      <div>
        <h1 class="wwh-title">
          {{ $t("what-we-have.title") }}
        </h1>
        <p class="wwh-subtitle">
          {{ $t("what-we-have.subtitle") }}
        </p>
      </div>
    </header>

    <v-text-field
      v-model="search"
      data-testid="wwh-search"
      :label="$t('what-we-have.search-foods')"
      :prepend-inner-icon="$globals.icons.search"
      variant="solo-filled"
      flat
      clearable
      hide-details
      autocomplete="off"
      class="mb-3"
    />

    <div
      class="wwh-filter mb-2"
      role="group"
      :aria-label="$t('general.filter')"
    >
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        class="wwh-filter-btn"
        :class="{ 'wwh-filter-btn--active': filter === option.value }"
        :aria-pressed="filter === option.value"
        :data-testid="`wwh-filter-${option.value}`"
        @click="setFilter(option.value)"
      >
        <span class="wwh-filter-label">{{ option.label }}</span>
        <span class="wwh-filter-count">{{ option.count }}</span>
      </button>
    </div>

    <div class="d-flex align-center flex-wrap ga-2 mb-1">
      <v-switch
        v-if="anyInRecipes"
        v-model="onlyInRecipes"
        data-testid="wwh-only-recipes"
        :label="$t('what-we-have.only-foods-in-our-recipes')"
        color="primary"
        density="compact"
        hide-details
        class="ml-1"
      />
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        :prepend-icon="$globals.icons.search"
        data-testid="wwh-find-recipes"
        @click="findRecipes"
      >
        {{ $t("what-we-have.find-recipes-we-can-make") }}
      </v-btn>
    </div>

    <!-- Always present, so both people can see whether what's on screen has been saved -->
    <div
      class="wwh-status d-flex align-center ga-2 mb-3"
      :class="statusClass"
      role="status"
      aria-live="polite"
      data-testid="wwh-status"
    >
      <v-progress-circular
        v-if="saving.size"
        indeterminate
        size="16"
        width="2"
      />
      <v-icon
        v-else
        size="18"
      >
        {{ failed.size || loadFailed ? $globals.icons.alertCircle : $globals.icons.checkboxMarkedCircle }}
      </v-icon>
      <span class="wwh-status-text">{{ statusText }}</span>
      <v-spacer />
      <v-btn
        variant="text"
        :loading="refreshing"
        :prepend-icon="$globals.icons.refresh"
        data-testid="wwh-refresh"
        @click="refresh"
      >
        {{ $t("what-we-have.refresh") }}
      </v-btn>
    </div>

    <div
      v-if="!ready"
      class="d-flex justify-center py-8"
    >
      <AppLoader />
    </div>

    <v-alert
      v-else-if="loadFailed && !matchingFoods.length"
      type="error"
      variant="tonal"
      :icon="$globals.icons.alertCircle"
      data-testid="wwh-load-error"
    >
      {{ $t("what-we-have.could-not-load") }}
    </v-alert>

    <template v-else>
      <ul
        v-if="visibleFoods.length"
        class="wwh-list"
        data-testid="wwh-list"
      >
        <li
          v-for="food in visibleFoods"
          :key="food.id"
          class="wwh-row"
          :class="{ 'wwh-row--failed': failed.has(food.id) }"
          :data-food-id="food.id"
          :data-on-hand="isOnHand(food)"
        >
          <div class="wwh-name">
            <div class="wwh-name-text">
              {{ food.name }}
            </div>
            <button
              v-if="failed.has(food.id)"
              type="button"
              class="wwh-error"
              @click="retry(food.id)"
            >
              {{ $t("what-we-have.could-not-save") }}
            </button>
            <div
              v-else
              class="wwh-meta"
            >
              <span v-if="food.label">{{ food.label.name }} · </span>{{ $t("what-we-have.used-in-recipes", food.recipeCount ?? 0) }}
            </div>
          </div>

          <div
            class="wwh-toggle"
            role="group"
            :aria-label="food.name"
          >
            <button
              type="button"
              class="wwh-btn wwh-btn--have"
              :class="{ 'wwh-btn--active': isOnHand(food) }"
              :aria-pressed="isOnHand(food)"
              :disabled="saving.has(food.id)"
              @click="choose(food, true)"
            >
              <v-progress-circular
                v-if="saving.get(food.id) === true"
                indeterminate
                size="18"
                width="2"
              />
              <v-icon
                v-else
                size="20"
              >
                {{ $globals.icons.check }}
              </v-icon>
              <span>{{ $t("what-we-have.have-it") }}</span>
            </button>
            <button
              type="button"
              class="wwh-btn wwh-btn--out"
              :class="{ 'wwh-btn--active': !isOnHand(food) }"
              :aria-pressed="!isOnHand(food)"
              :disabled="saving.has(food.id)"
              @click="choose(food, false)"
            >
              <v-progress-circular
                v-if="saving.get(food.id) === false"
                indeterminate
                size="18"
                width="2"
              />
              <v-icon
                v-else
                size="20"
              >
                {{ $globals.icons.close }}
              </v-icon>
              <span>{{ $t("what-we-have.run-out") }}</span>
            </button>
          </div>
        </li>
      </ul>

      <div
        v-else
        class="text-center py-8"
        data-testid="wwh-empty"
      >
        <div class="text-h6">
          {{ $t("what-we-have.no-foods-match") }}
        </div>
        <div class="text-medium-emphasis">
          {{ $t("what-we-have.no-foods-match-hint") }}
        </div>
      </div>

      <div
        v-if="hiddenCount"
        class="d-flex justify-center mt-4"
      >
        <v-btn
          variant="tonal"
          size="large"
          @click="showMore"
        >
          {{ $t("what-we-have.show-more", { count: hiddenCount }) }}
        </v-btn>
      </div>
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core";
import { resetFoodStore } from "~/composables/store/use-food-store";
import { alert } from "~/composables/use-toast";
import { useRecipeFinderPreferences } from "~/composables/use-users/preferences";
import { useWhatWeHave } from "~/composables/use-what-we-have";
import type { AvailabilityFilter } from "~/composables/use-what-we-have";
import type { IngredientFoodOut } from "~/lib/api/types/recipe";

definePageMeta({
  middleware: ["auth"],
});

// how often to pick up changes made by the other household member while the page is open
const REFRESH_INTERVAL_MS = 30_000;

const i18n = useI18n();
const auth = useMealieAuth();
const router = useRouter();

useSeoMeta({
  title: i18n.t("what-we-have.title"),
});

const {
  ready,
  refreshing,
  loadFailed,
  lastUpdated,
  search,
  filter,
  onlyInRecipes,
  saving,
  failed,
  anyInRecipes,
  counts,
  matchingFoods,
  visibleFoods,
  hiddenCount,
  isOnHand,
  refresh,
  setOnHand,
  retry,
  setFilter,
  showMore,
} = useWhatWeHave(() => auth.user.value?.householdSlug);

const filterOptions = computed<{ value: AvailabilityFilter; label: string; count: number }[]>(() => [
  { value: "all", label: i18n.t("what-we-have.filter-all"), count: counts.value.all },
  { value: "have", label: i18n.t("what-we-have.have-it"), count: counts.value.have },
  { value: "out", label: i18n.t("what-we-have.run-out"), count: counts.value.out },
]);

const statusText = computed(() => {
  if (saving.size) {
    return i18n.t("what-we-have.saving");
  }
  if (failed.size) {
    return i18n.t("what-we-have.changes-not-saved", failed.size);
  }
  if (loadFailed.value) {
    return i18n.t("what-we-have.showing-old-list");
  }
  if (!lastUpdated.value) {
    return "";
  }
  const time = lastUpdated.value.toLocaleTimeString(i18n.locale.value, { hour: "2-digit", minute: "2-digit" });
  return `${i18n.t("what-we-have.all-changes-saved")} · ${i18n.t("what-we-have.updated-at", { time })}`;
});

const statusClass = computed(() => {
  if (saving.size) {
    return "wwh-status--saving";
  }
  return failed.size || loadFailed.value ? "wwh-status--error" : "wwh-status--ok";
});

// other pages cache the foods, so they have to reload them once something here has changed
let changedAnything = false;

async function choose(food: IngredientFoodOut, value: boolean) {
  changedAnything = true;
  const ok = await setOnHand(food.id, value);
  if (!ok && failed.has(food.id)) {
    alert.error(i18n.t("what-we-have.could-not-save-food", { food: food.name }));
  }
}

function findRecipes() {
  // the finder reads its options from the saved preferences, so set the one that makes it
  // search from what's on hand without any ingredient being picked
  const preferences = useRecipeFinderPreferences();
  preferences.value.includeFoodsOnHand = true;
  preferences.value.requireAllFoodsAvailable = true;
  router.push(`/g/${auth.user.value?.groupSlug}/recipes/finder`);
}

const visibility = useDocumentVisibility();
const { pause, resume } = useIntervalFn(refresh, REFRESH_INTERVAL_MS, { immediate: false });

watch(visibility, (state) => {
  if (state === "visible") {
    refresh();
    resume();
  }
  else {
    pause();
  }
});

onMounted(async () => {
  await refresh();
  if (visibility.value === "visible") {
    resume();
  }
});

onBeforeUnmount(() => {
  pause();
  if (changedAnything) {
    resetFoodStore();
  }
});
</script>

<style scoped>
.wwh-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0 16px;
}

.wwh-title {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.2;
}

.wwh-subtitle {
  margin: 2px 0 0;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.wwh-filter {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.wwh-filter-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 6px 4px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 12px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font: inherit;
  cursor: pointer;
}

.wwh-filter-btn--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.wwh-filter-label {
  font-weight: 600;
}

.wwh-filter-count {
  font-size: 0.8rem;
  opacity: 0.85;
}

.wwh-status {
  min-height: 40px;
  padding: 2px 4px 2px 10px;
  border-radius: 8px;
  font-size: 0.875rem;
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.wwh-status--ok {
  color: rgb(var(--v-theme-success));
}

.wwh-status--saving {
  color: rgb(var(--v-theme-info));
}

.wwh-status--error {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.1);
  font-weight: 600;
}

.wwh-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.wwh-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.wwh-row--failed {
  background: rgba(var(--v-theme-error), 0.08);
}

.wwh-name {
  flex: 1 1 130px;
  min-width: 0;
}

.wwh-name-text {
  font-size: 1.05rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.wwh-meta {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.wwh-error {
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-error));
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.wwh-toggle {
  display: flex;
  flex: 0 0 auto;
}

.wwh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 96px;
  min-height: 48px;
  padding: 0 10px;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.25);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.wwh-btn--have {
  border-radius: 12px 0 0 12px;
  border-right-width: 1px;
}

.wwh-btn--out {
  border-radius: 0 12px 12px 0;
  border-left-width: 1px;
}

.wwh-btn--have.wwh-btn--active {
  border-color: rgb(var(--v-theme-success));
  background: rgb(var(--v-theme-success));
  color: #fff;
}

.wwh-btn--out.wwh-btn--active {
  border-color: rgba(var(--v-theme-on-surface), 0.75);
  background: rgba(var(--v-theme-on-surface), 0.75);
  color: rgb(var(--v-theme-surface));
}

.wwh-btn:disabled {
  cursor: progress;
}

.wwh-btn:focus-visible,
.wwh-filter-btn:focus-visible {
  outline: 3px solid rgb(var(--v-theme-info));
  outline-offset: 2px;
}
</style>
