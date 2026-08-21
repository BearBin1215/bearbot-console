import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Layout from './components/layout';
import Background from './components/background';
import MissedTasksChecker from './components/missed-tasks-checker';
import { useSettingsStore } from './stores/settings-store';
import { useIpcListeners } from './hooks/use-ipc-listeners';
import './index.css';

function App() {
  // 应用级 IPC 订阅与初始数据加载（在根组件调用一次）
  useIpcListeners();
  const uiFont = useSettingsStore((s) => s.uiFont);
  const codeFont = useSettingsStore((s) => s.codeFont);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          fontFamily: uiFont || void 0,
          fontFamilyCode: codeFont || 'monospace',
        },
        cssVar: {
          key: 'css-var-bearbot',
        },
      }}
      modal={{ centered: true }}
    >
      <AntApp className='relative h-full'>
        <Background />
        <div className='relative z-10 h-full'>
          <Layout />
        </div>
        <MissedTasksChecker />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
