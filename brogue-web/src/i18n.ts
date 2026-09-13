import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import zhCN from './locales/zh_CN.json';

i18next.init({
    lng: 'zh_CN',
    fallbackLng: 'zh_CN',
    resources: {
        zh_CN: {
            translation: zhCN
        }
    }
});

export default function setupI18n(app: any) {
    app.use(I18NextVue, { i18next });
}
