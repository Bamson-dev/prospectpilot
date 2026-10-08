import os
import glob
import re
import math
import subprocess

def rename_and_pad():
    """Rename all files to have 10-digit padded view count"""
    for folder in ['transcripts', 'clean']:
        if not os.path.exists(folder):
            continue
            
        for filepath in glob.glob(f"{folder}/*"):
            basename = os.path.basename(filepath)
            
            # The format is VIEWCOUNT_TITLE.ext
            # Let's match the starting numbers
            match = re.match(r'^(\d+)(_.*)$', basename)
            if match:
                view_count = int(match.group(1))
                rest = match.group(2)
                
                new_basename = f"{view_count:010d}{rest}"
                if new_basename != basename:
                    new_filepath = os.path.join(folder, new_basename)
                    os.rename(filepath, new_filepath)
                    print(f"Renamed: {basename} -> {new_basename}")

def calculate_stats():
    """Calculate and print required stats"""
    vtt_files = glob.glob('transcripts/*.vtt')
    txt_files = glob.glob('clean/*.txt')
    
    # Lines in done.txt
    done_lines = 0
    if os.path.exists('done.txt'):
        with open('done.txt', 'r') as f:
            done_lines = len(f.readlines())
            
    # Calculate average time per video
    # We sort vtt files by creation/modification time and find average gap
    if len(vtt_files) > 1:
        # Get mod times
        times = sorted([os.path.getmtime(f) for f in vtt_files])
        gaps = [times[i] - times[i-1] for i in range(1, len(times))]
        
        # Filter out massive gaps (e.g., between the two runs)
        # We assume typical download takes 2s sleep + 2-5s download
        valid_gaps = [g for g in gaps if g < 300] # less than 5 minutes
        
        if valid_gaps:
            avg_seconds = sum(valid_gaps) / len(valid_gaps)
        else:
            avg_seconds = 5.0 # fallback
    else:
        avg_seconds = 5.0 # fallback
        
    # Estimate hours left for long videos (524 videos)
    # The queue has 524 videos. Let's see how many videos downloaded.
    # Because of auto-subs vs manual-subs, we count unique titles
    unique_videos = set([re.sub(r'\.en.*\.vtt$', '', os.path.basename(f)) for f in vtt_files])
    downloaded_videos_count = len(unique_videos)
    
    remaining_videos = max(0, 524 - downloaded_videos_count)
    estimated_seconds_left = remaining_videos * avg_seconds
    estimated_hours_left = estimated_seconds_left / 3600.0
    
    print("=== STATISTICS ===")
    print(f"VTT files: {len(vtt_files)}")
    print(f"TXT files: {len(txt_files)}")
    print(f"done.txt lines: {done_lines}")
    print(f"Average seconds per video: {avg_seconds:.2f}")
    print(f"Estimated hours left for videos: {estimated_hours_left:.2f}")
    print("==================")

def main():
    # 1. Delete .en-orig.vtt
    orig_files = glob.glob('transcripts/*.en-orig.vtt')
    for f in orig_files:
        print(f"Deleting {f}")
        os.remove(f)
        
    # 2. Rename and pad
    rename_and_pad()
    
    # 3. Ensure all have matching txt
    vtt_files = glob.glob('transcripts/*.vtt')
    for vtt in vtt_files:
        basename = os.path.basename(vtt)
        name_without_ext = re.sub(r'\.en.*\.vtt$', '', basename)
        if name_without_ext == basename:
            name_without_ext = os.path.splitext(basename)[0]
            
        txt_path = os.path.join('clean', name_without_ext + '.txt')
        if not os.path.exists(txt_path):
            print(f"Missing {txt_path}, cleaning {vtt}...")
            # We will use the existing clean_vtt script
            subprocess.run(["python3", "clean_vtt.py", vtt], check=True)
            
    # Remove orphan txt files
    txt_files = glob.glob('clean/*.txt')
    valid_txts = set([re.sub(r'\.en.*\.vtt$', '', os.path.basename(f)) for f in glob.glob('transcripts/*.vtt')])
    for txt in txt_files:
        base = os.path.splitext(os.path.basename(txt))[0]
        if base not in valid_txts:
            print(f"Deleting orphan txt: {txt}")
            os.remove(txt)
            
    # 4. Calculate stats
    calculate_stats()

if __name__ == '__main__':
    main()
