""" SSH Helper to ssh and scp v0.2

Usage:
  ssh.py [-f FILE] [-t HOST] [-d DIR] [-c CONFIG] [-r REVERSE]
  ssh.py -h | --help | --version

Options:
 -h --help                    show this help message and exit
 --version                    show version and exit
 -f FILE --file=FILE          the send file name
 -c CONFIG --config=CONFIG    use config file to override the default ssh connection (NOT IMPLEMENTED YET)
 -t HOST --target=HOST        the dest host id or alias
 -d DIR --dir=DIR             the directory of scp dest[default: /tmp]
 -r --reverse <true_or_false>  scp target:file to local[default: False]                 
"""


from docopt import docopt
import subprocess
import sys
import logging
import pathlib
import json
Path = pathlib.Path

logging.basicConfig(
  level    = logging.DEBUG,
  format   = '%(asctime)s  %(filename)s %(lineno)dL %(funcName)s : %(levelname)s  %(message)s',
  datefmt  = '%Y-%m-%d %H:%M:%S',
  # filename = "ssh.log",
  # filemode = 'w'
)
# console = logging.StreamHandler()
# console.setLevel(logging.INFO)
# formatter = logging.Formatter('%(asctime)s  %(filename)s %(lineno)dL %(funcName)s : %(levelname)s  %(message)s')
# console.setFormatter(formatter)  
# logging.getLogger().addHandler(console)

class Host(object):
  __slots__ = [
    'ip',
    'port',
    'username',
    'pwd',
    'alias',
  ]

  def __init__(self, kwargs):
    super().__init__()
    self.ip = None
    self.port = None
    self.username = None
    self.pwd = None  # this pwd is password file in the dir: ~/.sshpass
    self.alias = None

    for f, v in kwargs.items():
      if f == 'pwd':
        v = '~/.sshpass/'+v
      setattr(self, f, v)

  def sshcommand(self):
    return f'sshpass -f {self.pwd} ssh -t -p {self.port} {self.username}@{self.ip}'

  @property
  def name(self):
    return self.alias



class HostLib:
  def __init__(self, config=None):
    self.hosts = []
    self.alias_dict = dict()

    with open('hosts_config.json') as fin:
      configs = json.load(fin)

    for c in configs:
      self.hosts.append(Host(c))

    for i, host in enumerate(self.hosts):
      if host.name != None:
        self.alias_dict[host.name] = i

  def Help(self):
    pass

  def get(self, target):
    if target.isdigit():
      index = int(target)
      if index >= len(self.hosts):
        self.Help()
        exit(1)
      return self.hosts[index]
    else:
      if target not in self.alias_dict.keys():
        self.Help()
        exit(1)
      return self.hosts[self.alias_dict[target]]


class FastSSH:
  def __init__(self, hostlib, target, filename=None, dire=None, reverse=False):
    self.hostlib = hostlib
    self.target = target
    self.host = self.hostlib.get(self.target)
    self.filename = filename
    self.dire = dire
    self.re = reverse

    if self.filename is None:
      self.connect()
    else:
      is_dir = False
      t_filename = self.filename
      if '/' in t_filename:
        t_filename = self.filename.split('/')[-1]
      if '.' in t_filename:
        if t_filename[-1].isalpha():
          # suppose the directory should not be xxx.*[a-z]
          is_dir = False
        else:
          is_dir = True
      else:
        is_dir = True
      self.scp(is_dir=is_dir)

  def connect(self):
    command_ = ""
    if self.host.name == "node335":
      command1 = self.hostlib.get("node307").sshcommand()
      command = f'ssh -p {self.host.port} {self.host.username}@{self.host.ip}'
      command_ = command1 + " " + command
    else:
      command_ = self.host.sshcommand()
    logging.info(command_)
    # ssh = subprocess.Popen(command_, shell=False, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    # result = ssh.stdout.readlines()
    # if result == []:
    #   error = ssh.stderr.readlines()
    #   print >> sys.stderr, "ERROR: %s" % error
    # else:
    #   print result
    subprocess.call(command_, shell=True)

  def scp(self, is_dir=False):
    assert (self.dire)
    if self.dire == None:
      self.dire = "/tmp"
    command_ = ""

    if self.re:
      if is_dir:
        command_ = f'sshpass -f {self.host.pwd} scp -r -P {self.host.port} {self.host.username}@{self.host.ip}:{self.filename} {self.dire}'
      else:
        command_ = f'sshpass -f {self.host.pwd} scp -P {self.host.port} {self.host.username}@{self.host.ip}:{self.filename} {self.dire}'
    else:
      if is_dir:
        command_ = f'sshpass -f {self.host.pwd} scp -r -P {self.host.port} {self.filename} {self.host.username}@{self.host.ip}:{self.dire}'        
      else:
        command_ = f'sshpass -f {self.host.pwd} scp -P {self.host.port} {self.filename} {self.host.username}@{self.host.ip}:{self.dire}'                
    logging.info(command_)
    subprocess.call(command_, shell=True)

if __name__ == '__main__':
  args = docopt(__doc__, version='0.2')
  target = args['--target']
  filename = args['--file']
  dir_ = args['--dir']
  config_file = args['--config']
  reverse = True if args['--reverse'] == 'True' else False

  hostlib = HostLib(config=config_file)
  FastSSH(hostlib, target=target, filename=filename, dire=dir_, reverse=reverse)
