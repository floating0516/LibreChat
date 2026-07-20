import { useRecoilValue } from 'recoil';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Dropdown, Spinner } from '@librechat/client';
import type { InterfaceStyle } from '~/Providers/AppearanceContext';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

export const ThemeSelector = ({
  theme,
  onChange,
  portal = true,
}: {
  theme: string;
  onChange: (value: string) => void;
  portal?: boolean;
}) => {
  const localize = useLocalize();

  const themeOptions = [
    { value: 'system', label: localize('com_nav_theme_system') },
    { value: 'dark', label: localize('com_nav_theme_dark') },
    { value: 'light', label: localize('com_nav_theme_light') },
  ];

  const labelId = 'theme-selector-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_theme')}</div>

      <Dropdown
        value={theme}
        onChange={onChange}
        options={themeOptions}
        sizeClasses="w-[180px]"
        testId="theme-selector"
        className="z-50"
        aria-labelledby={labelId}
        portal={portal}
      />
    </div>
  );
};

export const InterfaceStyleSelector = ({
  interfaceStyle,
  onChange,
}: {
  interfaceStyle: InterfaceStyle;
  onChange: (value: InterfaceStyle) => void;
}) => {
  const localize = useLocalize();
  const labelId = 'interface-style-selector-label';
  const styleOptions: {
    value: InterfaceStyle;
    label: string;
    swatches: readonly [string, string];
  }[] = [
    {
      value: 'default',
      label: localize('com_nav_interface_style_default'),
      swatches: ['#ffffff', '#10b981'],
    },
    {
      value: 'claude',
      label: localize('com_nav_interface_style_claude'),
      swatches: ['#f0ece0', '#c96442'],
    },
    {
      value: 'chatgpt',
      label: localize('com_nav_interface_style_chatgpt'),
      swatches: ['#212121', '#ececec'],
    },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div id={labelId}>{localize('com_nav_interface_style')}</div>
      <RadioGroup.Root
        value={interfaceStyle}
        orientation="horizontal"
        onValueChange={(value) => {
          const option = styleOptions.find((candidate) => candidate.value === value);
          if (option) {
            onChange(option.value);
          }
        }}
        aria-labelledby={labelId}
        className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-border-light sm:w-[320px]"
        data-testid="interface-style-selector"
      >
        {styleOptions.map((option, index) => {
          const selected = interfaceStyle === option.value;
          return (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1.5 border-r border-border-light px-2 py-2 text-xs transition-colors last:border-r-0',
                selected
                  ? 'bg-surface-active-alt font-medium text-text-primary'
                  : 'bg-surface-primary text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                index === 0 && 'rounded-l-[7px]',
                index === styleOptions.length - 1 && 'rounded-r-[7px]',
              )}
            >
              <span className="flex shrink-0 -space-x-1" aria-hidden="true">
                {option.swatches.map((color) => (
                  <span
                    key={color}
                    className="h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/20"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="truncate">{option.label}</span>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
    </div>
  );
};

export const LangSelector = ({
  langcode,
  onChange,
  portal = true,
}: {
  langcode: string;
  onChange: (value: string) => void;
  portal?: boolean;
}) => {
  const localize = useLocalize();
  const isLanguageLoading = useRecoilValue(store.languageLoading);

  const languageOptions = [
    { value: 'auto', label: localize('com_nav_lang_auto') },
    { value: 'en-US', label: localize('com_nav_lang_english') },
    { value: 'zh-Hans', label: localize('com_nav_lang_chinese') },
    { value: 'zh-Hant', label: localize('com_nav_lang_traditional_chinese') },
    { value: 'ar-EG', label: localize('com_nav_lang_arabic') },
    { value: 'bs', label: localize('com_nav_lang_bosnian') },
    { value: 'da-DK', label: localize('com_nav_lang_danish') },
    { value: 'de-DE', label: localize('com_nav_lang_german') },
    { value: 'es-ES', label: localize('com_nav_lang_spanish') },
    { value: 'ca-ES', label: localize('com_nav_lang_catalan') },
    { value: 'et-EE', label: localize('com_nav_lang_estonian') },
    { value: 'fa-IR', label: localize('com_nav_lang_persian') },
    { value: 'fr-FR', label: localize('com_nav_lang_french') },
    { value: 'he-HE', label: localize('com_nav_lang_hebrew') },
    { value: 'hu-HU', label: localize('com_nav_lang_hungarian') },
    { value: 'hy-AM', label: localize('com_nav_lang_armenian') },
    { value: 'is', label: localize('com_nav_lang_icelandic') },
    { value: 'it-IT', label: localize('com_nav_lang_italian') },
    { value: 'nb', label: localize('com_nav_lang_norwegian_bokmal') },
    { value: 'nn', label: localize('com_nav_lang_norwegian_nynorsk') },
    { value: 'pl-PL', label: localize('com_nav_lang_polish') },
    { value: 'pt-BR', label: localize('com_nav_lang_brazilian_portuguese') },
    { value: 'pt-PT', label: localize('com_nav_lang_portuguese') },
    { value: 'ru-RU', label: localize('com_nav_lang_russian') },
    { value: 'sk', label: localize('com_nav_lang_slovak') },
    { value: 'ja-JP', label: localize('com_nav_lang_japanese') },
    { value: 'ka-GE', label: localize('com_nav_lang_georgian') },
    { value: 'cs-CZ', label: localize('com_nav_lang_czech') },
    { value: 'sv-SE', label: localize('com_nav_lang_swedish') },
    { value: 'ko-KR', label: localize('com_nav_lang_korean') },
    { value: 'lt-LT', label: localize('com_nav_lang_lithuanian') },
    { value: 'lv-LV', label: localize('com_nav_lang_latvian') },
    { value: 'vi-VN', label: localize('com_nav_lang_vietnamese') },
    { value: 'th-TH', label: localize('com_nav_lang_thai') },
    { value: 'tr-TR', label: localize('com_nav_lang_turkish') },
    { value: 'ug', label: localize('com_nav_lang_uyghur') },
    { value: 'nl-NL', label: localize('com_nav_lang_dutch') },
    { value: 'id-ID', label: localize('com_nav_lang_indonesia') },
    { value: 'fi-FI', label: localize('com_nav_lang_finnish') },
    { value: 'sl', label: localize('com_nav_lang_slovenian') },
    { value: 'bo', label: localize('com_nav_lang_tibetan') },
    { value: 'uk-UA', label: localize('com_nav_lang_ukrainian') },
  ];

  const labelId = 'language-selector-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_language')}</div>

      <div className="flex items-center gap-2">
        {isLanguageLoading && (
          <span
            role="status"
            aria-label={localize('com_ui_loading')}
            className="flex size-5 items-center justify-center text-text-secondary"
          >
            <Spinner className="size-4" />
          </span>
        )}
        <Dropdown
          value={langcode}
          onChange={onChange}
          sizeClasses="[--anchor-max-height:256px] max-h-[60vh] w-[220px]"
          options={languageOptions}
          className="z-50"
          aria-labelledby={labelId}
          portal={portal}
          searchable
          searchPlaceholder={localize('com_ui_search_language')}
          searchEmptyText={localize('com_ui_no_results_found')}
        />
      </div>
    </div>
  );
};
