import { GithubOutlined } from '@ant-design/icons';
import { Button, Splitter, Tabs } from 'antd';
import TitleBar from './title-bar';
import TopNav from './top-nav';
import LogPanel from './log';
import Settings from './settings';
import TaskList from './task';

/** 布局 */
export default function Layout() {
  return (
    <div className='flex h-full flex-col'>
      <TitleBar />
      <TopNav />
      <Splitter className='flex-1 min-h-0'>
        <Splitter.Panel
          defaultSize='50%'
          min={430}
          collapsible
        >
          <Tabs
            defaultActiveKey='task'
            className='h-full'
            tabBarExtraContent={(
              <Button
                type='text'
                size='small'
                href='https://github.com/BearBin1215/bearbot-console'
                target='_blank'
                rel='noopener noreferrer'
                aria-label='查看 GitHub 仓库'
                icon={<GithubOutlined />}
              />
            )}
            styles={{
              header: {
                paddingLeft: 12,
                paddingRight: 12,
                marginBottom: 0,
                height: 47,
              },
              body: {
                height: '100%',
              },
              content: {
                height: '100%',
                overflowY: 'scroll',
              },
            }}
            items={[
              {
                key: 'task',
                label: '任务管理',
                children: <TaskList />,
              },
              {
                key: 'app',
                label: '应用设置',
                children: <Settings />,
              },
            ]}
          />
        </Splitter.Panel>
        <Splitter.Panel
          min={320}
          collapsible
        >
          <LogPanel />
        </Splitter.Panel>
      </Splitter>
    </div>
  );
}
