<template>
  <!--
    Dev instance only (branch layer/3-dev-branding; never sent upstream). A fixed strip on every
    page, login included, so the test copy cannot be mistaken for the real Mealie.
  -->
  <v-footer
    app
    height="30"
    color="#FFD600"
    class="dev-environment-bar d-print-none"
    data-testid="dev-environment-bar"
  >
    <span class="dev-environment-bar__label">MEALIE DEV</span>
    <span class="dev-environment-bar__text">test copy · not our real recipes</span>
  </v-footer>
</template>

<style scoped>
.dev-environment-bar {
  justify-content: center;
  gap: 8px;
  padding: 0 8px;
  color: #000 !important;
  font-size: 0.8rem;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  /* above the navigation drawer and its scrim, so it is never covered */
  z-index: 2011 !important;
}

.dev-environment-bar__label {
  padding: 3px 8px;
  border-radius: 4px;
  background: #000;
  color: #ffd600;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.dev-environment-bar__text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
</style>
