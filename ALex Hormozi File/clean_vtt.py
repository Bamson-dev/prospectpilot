import sys
import os
import glob
import webvtt
import re
import datetime

def clean_file(vtt_path):
    if not vtt_path.endswith('.vtt'):
        return
        
    basename = os.path.basename(vtt_path)
    name_without_ext = re.sub(r'\.en.*\.vtt$', '', basename)
    if name_without_ext == basename: # Fallback
        name_without_ext = os.path.splitext(basename)[0]
        
    os.makedirs("clean", exist_ok=True)
    txt_path = os.path.join("clean", name_without_ext + ".txt")
    
    if os.path.exists(txt_path):
        return
        
    try:
        vtt = webvtt.read(vtt_path)
        lines = []
        last_line = None
        
        for caption in vtt:
            text = re.sub(r'<[^>]+>', '', caption.text)
            for line in text.split('\n'):
                line = line.strip()
                if line and line != last_line:
                    lines.append(line)
                    last_line = line
                    
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
            
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{now}] Finished cleaning: {vtt_path}")
    except Exception as e:
        print(f"Error processing {vtt_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        for f in sys.argv[1:]:
            clean_file(f)
    else:
        vtt_files = glob.glob("transcripts/*.vtt")
        for f in vtt_files:
            clean_file(f)
