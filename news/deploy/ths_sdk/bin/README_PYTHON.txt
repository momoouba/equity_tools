在调用前必须调用 ldd libShellExport.so, ldd hqdatafeed和 ldd libFTDataInterface.so 查看本库所
需要依赖的环境是否已经齐全, 如果不齐全,请使用yum 或者 apt-get安装

how to use this iFinDPy.py
1、install 
   32位调用bin目录中的installiFinDPy.py安装，输入参数为文件压缩后的文件路径
   例如:压缩包解压放在/lib目录下
   sudo python  /lib/bin/installiFinDPy.py /lib
   
   64位调用bin64目录中的installiFinDPy.py安装，输入参数为文件压缩后的文件路径
   例如:压缩包解压放在/lib目录下
   python  /lib/bin64/installiFinDPy.py /lib
2、use
   导入iFinDPy.py模块  
       from iFinDPy import *
       调用对应的函数即可,bin目录下有一个sample.py 使用案例