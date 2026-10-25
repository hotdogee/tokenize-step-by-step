<script lang="ts">
  /**
   * The keyboard map (05 §8) as tables, shared by the `?` dialog and About › Keyboard (group titles are h3 under the
   * dialog's / section's h2).
   */
  import { i18n } from '../i18n/locale.svelte.ts';
  import { SHORTCUT_GROUPS } from './shortcuts.ts';
</script>

<div class="groups">
  {#each SHORTCUT_GROUPS as group (group.title)}
    <section class="group" aria-label={i18n.t(group.title)}>
      <h3 class="group-title">{i18n.t(group.title)}</h3>
      <table>
        <tbody>
          {#each group.rows as row (row.description)}
            <tr>
              <th scope="row" class="keys">
                {#each row.keys as key, i (key)}
                  {#if i > 0}<span class="sep" aria-hidden="true"
                      >{row.description === 'help.key.jump' ? '–' : '/'}</span
                    >{/if}<kbd>{key}</kbd>
                {/each}
                {#if row.singleKey}<span class="mark" aria-hidden="true">*</span><span class="visually-hidden"
                    >({i18n.t('help.singleKeyMark')})</span
                  >{/if}
              </th>
              <td class="prose">{i18n.t(row.description)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/each}
</div>

<style>
  .groups {
    display: grid;
    gap: 1rem;
  }

  .group-title {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 0.3rem 0.25rem;
    border-block-end: var(--border-width) solid var(--surface-3);
    text-align: start;
    vertical-align: top;
  }

  .keys {
    width: 9.5rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .sep {
    padding-inline: 0.2rem;
    color: var(--fg-muted);
  }

  .mark {
    padding-inline-start: 0.2rem;
    font-weight: 700;
  }
</style>
