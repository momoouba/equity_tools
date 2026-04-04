1. 本程序是基于 centos5.6 32位版本编译的1.0版本, 提供动态库调用, 具体调用例子请参考test例子

2. 在使用前必须调用 ldd libShellExport.so, ldd hqdatafeed和 ldd libFTDataInterface.so 查看所依赖的环境是否已经齐全, 如果不齐全,请使用yum或者apt-get安装


3. 在编译使用前,请添加当前目录到系统环境变量 LD_LIBRARY_PATH; 由于本程序使用到了配置文件,请勿复制到系统目录,否则会导致数据异常,
如果当前目录是 /root/Linux/bin
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/root/Linux/bin

注意:
	(1) 如果使用动态加载的方式加载, 必须在程序编译时添加 -lpthread 否则可能在
		异步接口或者实时接口多线程崩溃
	(2) 调用动态库登录成功后会有单独 hqdatafeed 进程单独启动,这个进程用于实时行情推送
		请勿kill
		
	