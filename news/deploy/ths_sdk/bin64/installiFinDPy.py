import platform
import sys
import os


def InstallPython():
    
    plate = platform.architecture()
    strbit= plate[0]
    iswin = 'Windows' in platform.system();
    version=sys.version  
    #print(version);
    verss=version.split()[0].split('.');
    ver=int(verss[0])+float(verss[1])/10;
    bit=int(strbit.split('bit')[0]);

    #if(len(sys.argv)<=1):
        #print('No iFinDPy path!');
        #return;
    #print(sys.argv[1:])
    if(len(sys.argv)<=1):
        srcpath=sys.path[0]
        srcpath=os.path.dirname(srcpath)
    else:
        srcpath=sys.argv[1]
    if(iswin):
        if not (srcpath.endswith('\\')):
            srcpath=srcpath+'\\'
    else:     
        if not (srcpath.endswith('/')):
            srcpath=srcpath+'/'
        
    #sitepath=".";
    try:
        #Python3
        import sysconfig
        sitepath = sysconfig.get_paths()["purelib"]
    except ImportError:
        #Python2
        from distutils.sysconfig import get_python_lib
        sitepath = get_python_lib()
    if(bit==64 ):
        print('Python is 64 bits')
        srcpath=srcpath+"bin64"
    else:
        print('Python is 32 bits')
        srcpath=srcpath+"bin"
    if(iswin):
        filepath=sitepath+"\\iFinDPy.pth"
    else:
        filepath=sitepath+"/iFinDPy.pth"
    if(ver<2.6):
        print('Error: Python version must be >=2.6!')
        return;

    #print(srcpath);
    sitefile=open(filepath,'w');
    sitefile.writelines(srcpath)
    sitefile.close();
    print('Installed into'),
    print(sitepath),
    print('OK!');


InstallPython()
