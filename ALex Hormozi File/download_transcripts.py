import os
import subprocess
import time
import json
import sys

OUTPUT_TEMPLATE = "transcripts/%(view_count)010d_%(title)s.%(ext)s"
ARCHIVE_FILE = "done.txt"

def run_ytdlp(url, use_cookies=False):
    """
    Run yt-dlp on a single url. Returns True if successful, False if blocked/failed.
    """
    cmd = [
        "yt-dlp",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "en",
        "--sleep-requests", "2",
        "--download-archive", ARCHIVE_FILE,
        "--force-write-archive",
        "--exec", "python3 clean_vtt.py",
        "-o", OUTPUT_TEMPLATE,
        url
    ]
    
    if use_cookies:
        cmd.extend(["--cookies-from-browser", "chrome"])

    print(f"Running command for {url}")
    
    try:
        subprocess.run(cmd, check=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"yt-dlp failed with exit code {e.returncode}.")
        return False

def download_with_retry(url):
    print(f"Processing: {url}")
    while True:
        success = run_ytdlp(url, use_cookies=False)
        if success:
            print(f"Finished downloading from {url}")
            break
            
        print("Request blocked or failed. Retrying with Chrome cookies...")
        success = run_ytdlp(url, use_cookies=True)
        if success:
            print(f"Finished downloading from {url} using cookies")
            break
            
        print("Request blocked even with cookies. Waiting 30 minutes before retrying...")
        time.sleep(1800) # 30 minutes

def get_top_shorts(url, limit=500):
    print(f"Fetching flat playlist for {url} to find top {limit} videos...")
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--flat-playlist",
        url
    ]
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        print(f"Failed to fetch flat playlist: {e}")
        return []
        
    shorts = []
    for line in result.stdout.strip().split('\n'):
        if not line:
            continue
        try:
            data = json.loads(line)
            video_id = data.get('id')
            view_count = data.get('view_count')
            if video_id and view_count is not None:
                shorts.append({'id': video_id, 'view_count': view_count})
        except Exception as e:
            pass
            
    # Sort by view count descending
    shorts.sort(key=lambda x: x['view_count'], reverse=True)
    
    top_shorts = shorts[:limit]
    return [f"https://www.youtube.com/watch?v={s['id']}" for s in top_shorts]

def main():
    os.makedirs("transcripts", exist_ok=True)
    
    # 1. Process videos playlist fully
    videos_url = "https://www.youtube.com/@AlexHormozi/videos"
    download_with_retry(videos_url)
    
    # 2. Process shorts: top 500 only
    shorts_url = "https://www.youtube.com/@AlexHormozi/shorts"
    top_short_urls = get_top_shorts(shorts_url, limit=500)
    
    if not top_short_urls:
        print("Warning: Flat list had no view counts or failed.")
        return
        
    print(f"Found {len(top_short_urls)} top shorts. Beginning download...")
    
    # Download them by passing them as a single string of arguments, 
    # but to avoid command line length limits, we'll download in chunks or one-by-one.
    # Passing them all might be fine for 500 URLs, but let's do batches of 50.
    batch_size = 50
    for i in range(0, len(top_short_urls), batch_size):
        batch = top_short_urls[i:i+batch_size]
        # We can just write them to a temp file and use -a 
        with open("temp_urls.txt", "w") as f:
            f.write("\n".join(batch))
            
        download_with_retry("-a temp_urls.txt")
        
    if os.path.exists("temp_urls.txt"):
        os.remove("temp_urls.txt")
        
    print("All downloads complete.")

if __name__ == "__main__":
    main()
