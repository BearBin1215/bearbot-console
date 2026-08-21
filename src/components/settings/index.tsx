import AppSettings from './app-settings';
import InterfaceSettings from './interface-settings';
import NetworkSettings from './network-settings';

/** 应用设置 */
export default function Settings() {
  return (
    <div className='flex flex-col gap-2 p-3'>
      <fieldset className='flex flex-col gap-3 p-3 pt-2 border border-gray-200 rounded'>
        <legend className='text-secondary px-1'>界面设置</legend>
        <InterfaceSettings />
      </fieldset>
      <fieldset className='flex flex-col gap-3 p-3 pt-2 border border-gray-200 rounded'>
        <legend className='text-secondary px-1'>网络设置</legend>
        <NetworkSettings />
      </fieldset>
      <fieldset className='flex flex-col gap-3 p-3 pt-2 border border-gray-200 rounded'>
        <legend className='text-secondary px-1'>应用行为</legend>
        <AppSettings />
      </fieldset>
    </div>
  );
}
