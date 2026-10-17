import OsintTree from "@/components/osintTree";
import osintData from "@/data/osint-resources.json";


export default function Home() {

  
  return (
      <main className="h-full">
        <OsintTree data={osintData} />
      </main>
  );
}


